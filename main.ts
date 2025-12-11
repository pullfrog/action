import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { encode as toonEncode } from "@toon-format/toon";
import { type } from "arktype";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentName, Payload } from "./external.ts";
import { agentsManifest } from "./external.ts";
import { ensureProgressCommentUpdated, reportProgress } from "./mcp/comment.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { startMcpHttpServer } from "./mcp/server.ts";
import { getModes, modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import { fetchRepoSettings, fetchWorkflowRunInfo } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import { reportErrorToComment } from "./utils/errorReport.ts";
import {
  parseRepoContext,
  type RepoContext,
  revokeGitHubInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitBranch, setupGitConfig } from "./utils/setup.ts";
import { Timer } from "./utils/timer.ts";

// runtime validation using agents (needed for ArkType)
// Note: The AgentName type is defined in external.ts, this is the runtime validator

export const AgentInputKey = type.enumerated(
  ...Object.values(agents).flatMap((agent) => agent.apiKeyNames)
);
export type AgentInputKey = typeof AgentInputKey.infer;

const keyInputDefs = flatMorph(agents, (_, agent) =>
  agent.apiKeyNames.map((inputKey) => [inputKey, "string | undefined?"] as const)
);

export const Inputs = type({
  prompt: "string",
  ...keyInputDefs,
});

export type Inputs = typeof Inputs.infer;

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(inputs: Inputs): Promise<MainResult> {
  let mcpServerClose: (() => Promise<void>) | undefined;
  let payload: Payload | undefined;

  try {
    const timer = new Timer();

    // parse payload early to extract agent
    payload = parsePayload(inputs);

    const partialCtx = await initializeContext(inputs, payload);
    const ctx = partialCtx as MainContext;
    timer.checkpoint("initializeContext");

    setupGitAuth({
      githubInstallationToken: ctx.githubInstallationToken,
      repoContext: ctx.repoContext,
    });

    await setupTempDirectory(ctx);
    timer.checkpoint("setupTempDirectory");

    setupGitBranch(ctx.payload);

    await startMcpServer(ctx);
    mcpServerClose = ctx.mcpServerClose;
    timer.checkpoint("startMcpServer");

    // check for empty comment_ids in fix_review trigger - report and exit early
    if (
      ctx.payload.event.trigger === "fix_review" &&
      Array.isArray(ctx.payload.event.comment_ids) &&
      ctx.payload.event.comment_ids.length === 0
    ) {
      await reportProgress({
        body: `👍 **No approved comments found**\n\nTo use "Fix 👍s", add a 👍 reaction to one or more inline review comments you want fixed.`,
      });
      return { success: true };
    }

    setupMcpServers(ctx);

    await installAgentCli(ctx);
    timer.checkpoint("installAgentCli");

    await validateApiKey(ctx);

    const result = await runAgent(ctx);
    const mainResult = await handleAgentResult(result);
    return mainResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    try {
      await reportErrorToComment({ error: errorMessage });
    } catch {
      // error reporting failed, but don't let it mask the original error
    }
    await log.writeSummary();
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    // ensure progress comment is updated if it was never updated during execution
    // do this before revoking the token so we can still make API calls
    try {
      await ensureProgressCommentUpdated(payload);
    } catch {
      // error updating comment, but don't let it mask the original error
    }

    if (mcpServerClose) {
      await mcpServerClose();
    }
    await revokeGitHubInstallationToken();
  }
}

/**
 * Get agents that have matching API keys in the inputs
 */
function getAvailableAgents(inputs: Inputs): (typeof agents)[AgentName][] {
  return Object.values(agents).filter((agent) => {
    // for OpenCode, check if any API_KEY variable exists in inputs
    if (agent.name === "opencode") {
      return Object.keys(inputs).some((key) => key.includes("api_key"));
    }
    // for other agents, check apiKeyNames
    return agent.apiKeyNames.some((inputKey) => inputs[inputKey]);
  });
}

/**
 * Get all possible API key names from agentsManifest using flatMorph
 */
function getAllPossibleKeyNames(): string[] {
  return Object.keys(
    flatMorph(agentsManifest, (_, manifest) =>
      manifest.apiKeyNames.map((keyName) => [keyName, true] as const)
    )
  );
}

/**
 * Throw an error for missing API key with helpful message linking to repo settings
 */
async function throwMissingApiKeyError({
  agent,
  repoContext,
}: {
  agent: (typeof agents)[AgentName] | null;
  repoContext: RepoContext;
}): Promise<never> {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const settingsUrl = `${apiUrl}/console/${repoContext.owner}/${repoContext.name}`;

  const githubRepoUrl = `https://github.com/${repoContext.owner}/${repoContext.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  // for OpenCode, use a generic message since it accepts any API key
  const isOpenCode = agent?.name === "opencode";
  let secretNameList: string;
  if (isOpenCode) {
    secretNameList =
      "any API key (e.g., `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)";
  } else {
    const inputKeys = agent?.apiKeyNames || getAllPossibleKeyNames();
    const secretNames = inputKeys.map((key) => `\`${key.toUpperCase()}\``);
    secretNameList = inputKeys.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;
  }

  let message = `${
    agent === null
      ? "Pullfrog has no agent configured and no API keys are available in the environment."
      : `Pullfrog is configured to use ${agent.displayName}, but the associated API key was not provided.`
  }

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"`;

  if (agent === null) {
    message += `\n\nAlternatively, configure Pullfrog to use an agent at ${settingsUrl}`;
  }

  // report to comment if MCP context is available (server has started)
  await reportErrorToComment({ error: message });
  throw new Error(message);
}

interface MainContext {
  inputs: Inputs;
  githubInstallationToken: string;
  repoContext: RepoContext;
  agentName: AgentName;
  agent: (typeof agents)[AgentName];
  sharedTempDir: string;
  payload: Payload;
  mcpServerUrl: string;
  mcpServerClose: () => Promise<void>;
  mcpServers: ReturnType<typeof createMcpConfigs>;
  cliPath: string;
  apiKey: string;
  apiKeys: Record<string, string>;
}

async function initializeContext(
  inputs: Inputs,
  payload: Payload
): Promise<
  Omit<
    MainContext,
    "mcpServerUrl" | "mcpServerClose" | "mcpServers" | "cliPath" | "apiKey" | "apiKeys"
  >
> {
  log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);
  Inputs.assert(inputs);
  setupGitConfig();

  const githubInstallationToken = await setupGitHubInstallationToken();
  const repoContext = parseRepoContext();

  // resolve agent and update payload with resolved agent name
  const { agentName, agent } = await resolveAgent(
    inputs,
    payload,
    githubInstallationToken,
    repoContext
  );
  const resolvedPayload = { ...payload, agent: agentName };

  return {
    inputs,
    githubInstallationToken,
    repoContext,
    agentName,
    agent,
    payload: resolvedPayload,
    sharedTempDir: "",
  };
}

async function resolveAgent(
  inputs: Inputs,
  payload: Payload,
  githubInstallationToken: string,
  repoContext: RepoContext
): Promise<{ agentName: AgentName; agent: (typeof agents)[AgentName] }> {
  const repoSettings = await fetchRepoSettings({
    token: githubInstallationToken,
    repoContext,
  });

  const agentOverride = process.env.AGENT_OVERRIDE as AgentName | undefined;
  const configuredAgentName = agentOverride || payload.agent || repoSettings.defaultAgent || null;

  if (configuredAgentName) {
    const agentName = configuredAgentName;
    const agent = agents[agentName];
    if (!agent) {
      throw new Error(`invalid agent name: ${agentName}`);
    }

    // if explicitly configured (via override or payload), respect it even without matching keys
    // this allows users to force an agent selection (will fail later with clear error if no keys)
    const isExplicitOverride = agentOverride !== undefined || payload.agent !== null;

    if (isExplicitOverride) {
      log.info(`Selected configured agent: ${agentName}`);
      return { agentName, agent };
    }

    // for repo-level defaults, check if agent has matching keys before selecting
    const hasMatchingKey =
      agent.name === "opencode"
        ? Object.keys(inputs).some((key) => key.includes("api_key"))
        : agent.apiKeyNames.some((inputKey) => inputs[inputKey]);
    if (!hasMatchingKey) {
      log.warning(
        `Repo default agent ${agentName} has no matching API keys. Available agents: ${
          getAvailableAgents(inputs)
            .map((a) => a.name)
            .join(", ") || "none"
        }`
      );
      // fall through to auto-selection for repo defaults
    } else {
      log.info(`Selected configured agent: ${agentName}`);
      return { agentName, agent };
    }
  }

  const availableAgents = getAvailableAgents(inputs);
  const availableAgentNames = availableAgents.map((agent) => agent.name).join(", ");
  log.debug(`Available agents: ${availableAgentNames || "none"}`);

  if (availableAgents.length === 0) {
    await throwMissingApiKeyError({
      agent: null,
      repoContext,
    });
  }

  const agentName = availableAgents[0].name;
  const agent = availableAgents[0];
  log.info(`No agent configured, defaulting to first available agent: ${agentName}`);
  return { agentName, agent };
}

async function setupTempDirectory(
  ctx: Omit<MainContext, "payload" | "mcpServers" | "cliPath" | "apiKey">
): Promise<void> {
  ctx.sharedTempDir = await mkdtemp(join(tmpdir(), "pullfrog-"));
  process.env.PULLFROG_TEMP_DIR = ctx.sharedTempDir;
  log.info(`📂 PULLFROG_TEMP_DIR has been created at ${ctx.sharedTempDir}`);
}

function parsePayload(inputs: Inputs): Payload {
  try {
    const parsedPrompt = JSON.parse(inputs.prompt);
    if (!("~pullfrog" in parsedPrompt)) {
      throw new Error();
    }
    return parsedPrompt as Payload;
  } catch {
    return {
      "~pullfrog": true,
      agent: null,
      prompt: inputs.prompt,
      event: {
        trigger: "unknown",
      },
      modes,
    };
  }
}

async function startMcpServer(ctx: MainContext): Promise<void> {
  // fetch the pre-created progress comment ID from the database
  // this must be set BEFORE starting the MCP server so comment.ts can read it
  const runId = process.env.GITHUB_RUN_ID;
  if (runId) {
    const workflowRunInfo = await fetchWorkflowRunInfo(runId);
    if (workflowRunInfo.progressCommentId) {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
      log.info(`📝 Using pre-created progress comment: ${workflowRunInfo.progressCommentId}`);
    }
  }

  const allModes = [
    ...getModes({ disableProgressComment: ctx.payload.disableProgressComment }),
    ...(ctx.payload.modes || []),
  ];
  const { url, close } = await startMcpHttpServer({
    payload: ctx.payload,
    modes: allModes,
    agentName: ctx.agentName,
  });
  ctx.mcpServerUrl = url;
  ctx.mcpServerClose = close;
  log.info(`🚀 MCP server started at ${url}`);
}

function setupMcpServers(ctx: MainContext): void {
  ctx.mcpServers = createMcpConfigs(ctx.mcpServerUrl);
  log.debug(`📋 MCP Config: ${JSON.stringify(ctx.mcpServers, null, 2)}`);
}

async function installAgentCli(ctx: MainContext): Promise<void> {
  // gemini is the only agent that needs githubInstallationToken for install
  if (ctx.agentName === "gemini") {
    ctx.cliPath = await ctx.agent.install(ctx.githubInstallationToken);
  } else {
    ctx.cliPath = await ctx.agent.install();
  }
}

async function validateApiKey(ctx: MainContext): Promise<void> {
  // collect all matching API keys for this agent
  const apiKeys: Record<string, string> = {};
  for (const inputKey of ctx.agent.apiKeyNames) {
    const value = ctx.inputs[inputKey];
    if (value) {
      apiKeys[inputKey] = value;
    }
  }

  // for OpenCode: if no keys found in inputs, check process.env for any API_KEY variables
  if (ctx.agentName === "opencode" && Object.keys(apiKeys).length === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && key.includes("API_KEY")) {
        // convert env var name back to input key format (lowercase with underscores)
        const inputKey = key.toLowerCase();
        apiKeys[inputKey] = value;
      }
    }
  }

  if (Object.keys(apiKeys).length === 0) {
    await throwMissingApiKeyError({
      agent: ctx.agent,
      repoContext: ctx.repoContext,
    });
    // unreachable - throwMissingApiKeyError always throws
    return;
  }

  // keep apiKey for backward compat (first available key)
  ctx.apiKey = Object.values(apiKeys)[0];
  ctx.apiKeys = apiKeys;
}

async function runAgent(ctx: MainContext): Promise<AgentResult> {
  log.info(`Running ${ctx.agentName}...`);
  // strip context from event
  const { context: _context, ...eventWithoutContext } = ctx.payload.event;
  // format: prompt + two newlines + TOON encoded event
  const promptContent = `${ctx.payload.prompt}\n\n${toonEncode(eventWithoutContext)}`;
  log.box(promptContent, { title: "Prompt" });

  return ctx.agent.run({
    payload: ctx.payload,
    mcpServers: ctx.mcpServers,
    apiKey: ctx.apiKey,
    apiKeys: ctx.apiKeys,
    cliPath: ctx.cliPath,
  });
}

async function handleAgentResult(result: AgentResult): Promise<MainResult> {
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Agent execution failed",
      output: result.output!,
    };
  }

  log.success("Task complete.");
  await log.writeSummary();

  return {
    success: true,
    output: result.output || "",
  };
}
