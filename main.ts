import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { Octokit } from "@octokit/rest";
import { encode as toonEncode } from "@toon-format/toon";
import { type } from "arktype";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentName, Payload } from "./external.ts";
import { agentsManifest } from "./external.ts";
import { ensureProgressCommentUpdated, reportProgress } from "./mcp/comment.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { startMcpHttpServer } from "./mcp/server.ts";
import { getModes, type Mode, modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import { type PrepResult, runPrepPhase } from "./prep/index.ts";
import { fetchRepoSettings, fetchWorkflowRunInfo, type RepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import { reportErrorToComment } from "./utils/errorReport.ts";
import {
  parseRepoContext,
  revokeGitHubInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGit, setupGitConfig } from "./utils/setup.ts";
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
    const ctx = partialCtx as Context;
    timer.checkpoint("initializeContext");

    await setupGit(ctx);
    timer.checkpoint("setupGit");

    await setupTempDirectory(ctx);
    timer.checkpoint("setupTempDirectory");

    // TODO: david fix this garbage
    // run agent CLI installation and prep phase in parallel
    const [, prepResults] = await Promise.all([installAgentCli(ctx), runPrepPhase()]);
    ctx.prepResults = prepResults;

    // recompute modes now that we know if dependencies were preinstalled
    const dependenciesPreinstalled = prepResults.every((r) => r.dependenciesInstalled) || undefined;
    ctx.modes = [
      ...getModes({
        disableProgressComment: ctx.payload.disableProgressComment,
        dependenciesPreinstalled,
      }),
      ...(ctx.payload.modes || []),
    ];
    timer.checkpoint("installAgentCli+prepPhase");

    await startMcpServer(ctx);
    mcpServerClose = ctx.mcpServerClose;
    timer.checkpoint("startMcpServer");

    // check for empty comment_ids in fix_review trigger - report and exit early
    if (
      ctx.payload.event.trigger === "fix_review" &&
      Array.isArray(ctx.payload.event.comment_ids) &&
      ctx.payload.event.comment_ids.length === 0
    ) {
      await reportProgress(ctx, {
        body: `👍 **No approved comments found**\n\nTo use "Fix 👍s", add a 👍 reaction to one or more inline review comments you want fixed.`,
      });
      return { success: true };
    }

    setupMcpServers(ctx);

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
async function throwMissingApiKeyError(ctx: Context): Promise<never> {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const settingsUrl = `${apiUrl}/console/${ctx.owner}/${ctx.name}`;

  const githubRepoUrl = `https://github.com/${ctx.owner}/${ctx.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  // for OpenCode, use a generic message since it accepts any API key
  const isOpenCode = ctx.agent?.name === "opencode";
  let secretNameList: string;
  if (isOpenCode) {
    secretNameList =
      "any API key (e.g., `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)";
  } else {
    const inputKeys = ctx.agent?.apiKeyNames || getAllPossibleKeyNames();
    const secretNames = inputKeys.map((key) => `\`${key.toUpperCase()}\``);
    secretNameList = inputKeys.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;
  }

  const message = `Pullfrog is configured to use ${ctx.agent.displayName}, but the associated API key was not provided.

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"

Alternatively, configure Pullfrog to use a different agent at ${settingsUrl}`;

  // report to comment if MCP context is available (server has started)
  await reportErrorToComment({ error: message });
  throw new Error(message);
}

export interface Context {
  // flattened from RepoContext
  owner: string;
  name: string;

  // core fields
  inputs: Inputs;
  payload: Payload;
  repo: Awaited<ReturnType<Octokit["repos"]["get"]>>["data"];
  agentName: AgentName;
  agent: (typeof agents)[AgentName];
  githubInstallationToken: string;
  octokit: Octokit;

  // repo settings from Pullfrog API
  repoSettings: RepoSettings;

  // modes for MCP tools
  modes: Mode[];

  // setup fields
  sharedTempDir: string;

  // mcp fields
  mcpServerUrl: string;
  mcpServerClose: () => Promise<void>;
  mcpServers: ReturnType<typeof createMcpConfigs>;

  // agent fields
  cliPath: string;
  apiKey: string;
  apiKeys: Record<string, string>;

  // prep phase results
  prepResults: PrepResult[];

  // workflow run info
  runId: string;
  jobId: string | undefined;
}

async function initializeContext(
  inputs: Inputs,
  payload: Payload
): Promise<
  Omit<
    Context,
    | "mcpServerUrl"
    | "mcpServerClose"
    | "mcpServers"
    | "cliPath"
    | "apiKey"
    | "apiKeys"
    | "prepResults"
    | "runId"
    | "jobId"
  >
> {
  log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);
  Inputs.assert(inputs);
  setupGitConfig();

  const githubInstallationToken = await setupGitHubInstallationToken();
  const { owner, name } = parseRepoContext();

  // create octokit instance
  const octokit = new Octokit({
    auth: githubInstallationToken,
  });

  // fetch repo data
  const response = await octokit.repos.get({
    owner,
    repo: name,
  });
  const repo = response.data;

  // fetch repo settings
  const repoSettings = await fetchRepoSettings({
    token: githubInstallationToken,
    repoContext: { owner, name },
  });

  // resolve agent and update payload with resolved agent name
  const { agentName, agent } = resolveAgent({
    inputs,
    payload,
    repoSettings,
  });
  const resolvedPayload = { ...payload, agent: agentName };

  // compute modes from defaults + payload overrides
  // note: dependenciesPreinstalled is undefined here since prepPhase runs after this
  const computedModes = [
    ...getModes({
      disableProgressComment: resolvedPayload.disableProgressComment,
      dependenciesPreinstalled: undefined,
    }),
    ...(resolvedPayload.modes || []),
  ];

  return {
    owner,
    name,
    inputs,
    githubInstallationToken,
    octokit,
    repo,
    agentName,
    agent,
    payload: resolvedPayload,
    repoSettings,
    modes: computedModes,
    sharedTempDir: "",
  };
}

function resolveAgent({
  inputs,
  payload,
  repoSettings,
}: {
  inputs: Inputs;
  payload: Payload;
  repoSettings: RepoSettings;
}): { agentName: AgentName; agent: (typeof agents)[AgentName] } {
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
    // this will be caught and reported later in validateApiKey
    throw new Error("no agents available - missing API keys");
  }

  const agentName = availableAgents[0].name;
  const agent = availableAgents[0];
  log.info(`No agent configured, defaulting to first available agent: ${agentName}`);
  return { agentName, agent };
}

async function setupTempDirectory(ctx: Context): Promise<void> {
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

async function startMcpServer(ctx: Context): Promise<void> {
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId) {
    throw new Error("GITHUB_RUN_ID environment variable is required");
  }
  ctx.runId = runId;

  // fetch the pre-created progress comment ID from the database
  // this must be set BEFORE starting the MCP server so comment.ts can read it
  const workflowRunInfo = await fetchWorkflowRunInfo(ctx.runId);
  if (workflowRunInfo.progressCommentId) {
    process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
    log.info(`📝 Using pre-created progress comment: ${workflowRunInfo.progressCommentId}`);
  }

  // fetch job ID by matching GITHUB_JOB name
  const jobName = process.env.GITHUB_JOB;
  if (jobName) {
    const jobs = await ctx.octokit.rest.actions.listJobsForWorkflowRun({
      owner: ctx.owner,
      repo: ctx.name,
      run_id: parseInt(ctx.runId, 10),
    });
    const matchingJob = jobs.data.jobs.find((job) => job.name === jobName);
    if (matchingJob) {
      ctx.jobId = String(matchingJob.id);
      log.info(`📋 Found job ID: ${ctx.jobId}`);
    }
  }

  const { url, close } = await startMcpHttpServer(ctx);
  ctx.mcpServerUrl = url;
  ctx.mcpServerClose = close;
  log.info(`🚀 MCP server started at ${url}`);
}

function setupMcpServers(ctx: Context): void {
  ctx.mcpServers = createMcpConfigs(ctx.mcpServerUrl);
  log.debug(`📋 MCP Config: ${JSON.stringify(ctx.mcpServers, null, 2)}`);
}

async function installAgentCli(ctx: Context): Promise<void> {
  // gemini is the only agent that needs githubInstallationToken for install
  if (ctx.agentName === "gemini") {
    ctx.cliPath = await ctx.agent.install(ctx.githubInstallationToken);
  } else {
    ctx.cliPath = await ctx.agent.install();
  }
}

async function validateApiKey(ctx: Context): Promise<void> {
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
    await throwMissingApiKeyError(ctx);
    // unreachable - throwMissingApiKeyError always throws
    return;
  }

  // keep apiKey for backward compat (first available key)
  ctx.apiKey = Object.values(apiKeys)[0];
  ctx.apiKeys = apiKeys;
}

async function runAgent(ctx: Context): Promise<AgentResult> {
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
    prepResults: ctx.prepResults,
    repo: {
      owner: ctx.owner,
      name: ctx.name,
      defaultBranch: ctx.repo.default_branch,
    },
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
