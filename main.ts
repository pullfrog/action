import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { encode as toonEncode } from "@toon-format/toon";
import { type } from "arktype";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentName, AgentName as AgentNameType, Payload } from "./external.ts";
import { agentsManifest } from "./external.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { startMcpHttpServer } from "./mcp/server.ts";
import { modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import { fetchRepoSettings, fetchWorkflowRunInfo } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import {
  parseRepoContext,
  type RepoContext,
  revokeGitHubInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitBranch, setupGitConfig } from "./utils/setup.ts";

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

  try {
    // parse payload early to extract agent
    const payload = parsePayload(inputs);

    const partialCtx = await initializeContext(inputs, payload);
    const ctx = partialCtx as MainContext;

    setupGitAuth({
      githubInstallationToken: ctx.githubInstallationToken,
      repoContext: ctx.repoContext,
    });
    await setupTempDirectory(ctx);

    setupGitBranch(ctx.payload);
    await startMcpServer(ctx);
    mcpServerClose = ctx.mcpServerClose;
    setupMcpServers(ctx);
    await installAgentCli(ctx);
    validateApiKey(ctx);

    const result = await runAgent(ctx);
    return await handleAgentResult(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    await log.writeSummary();
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (mcpServerClose) {
      await mcpServerClose();
    }
    await revokeGitHubInstallationToken();
  }
}

/**
 * Get agents that have matching API keys in the inputs
 */
function getAvailableAgents(inputs: Inputs): (typeof agents)[AgentNameType][] {
  return Object.values(agents).filter((agent) =>
    agent.apiKeyNames.some((inputKey) => inputs[inputKey])
  );
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
function throwMissingApiKeyError({
  agentName,
  inputKeys,
  repoContext,
}: {
  agentName: string | null;
  inputKeys: string[];
  repoContext: RepoContext;
}): never {
  const apiUrl = process.env.API_URL || "https://pullfrog.ai";
  const settingsUrl = `${apiUrl}/console/${repoContext.owner}/${repoContext.name}`;

  const secretNames = inputKeys.map((key) => `\`${key.toUpperCase()}\``);
  const secretNameList =
    inputKeys.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;

  const githubRepoUrl = `https://github.com/${repoContext.owner}/${repoContext.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  let message = `${
    agentName === null
      ? "Pullfrog has no agent configured and no API keys are available in the environment."
      : `Pullfrog is configured to use ${agentName}, but the associated API key was not provided.`
  }

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"`;

  if (agentName === null) {
    message += `\n\nAlternatively, configure Pullfrog to use an agent at ${settingsUrl}`;
  }

  log.error(message);
  throw new Error(message);
}

interface MainContext {
  inputs: Inputs;
  githubInstallationToken: string;
  repoContext: RepoContext;
  agentName: AgentNameType;
  agent: (typeof agents)[AgentNameType];
  sharedTempDir: string;
  payload: Payload;
  mcpServerUrl: string;
  mcpServerClose: () => Promise<void>;
  mcpServers: ReturnType<typeof createMcpConfigs>;
  cliPath: string;
  apiKey: string;
}

async function initializeContext(
  inputs: Inputs,
  payload: Payload
): Promise<
  Omit<MainContext, "mcpServerUrl" | "mcpServerClose" | "mcpServers" | "cliPath" | "apiKey">
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
): Promise<{ agentName: AgentNameType; agent: (typeof agents)[AgentNameType] }> {
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
    log.info(`Selected configured agent: ${agentName}`);
    return { agentName, agent };
  }

  const availableAgents = getAvailableAgents(inputs);
  const availableAgentNames = availableAgents.map((agent) => agent.name).join(", ");
  log.debug(`Available agents: ${availableAgentNames || "none"}`);

  if (availableAgents.length === 0) {
    throwMissingApiKeyError({
      agentName: configuredAgentName,
      inputKeys: getAllPossibleKeyNames(),
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
  const allModes = [...modes, ...(ctx.payload.modes || [])];
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

function validateApiKey(ctx: MainContext): void {
  const matchingInputKey = ctx.agent.apiKeyNames.find((inputKey) => ctx.inputs[inputKey]);
  if (!matchingInputKey) {
    throwMissingApiKeyError({
      agentName: ctx.agentName,
      inputKeys: ctx.agent.apiKeyNames,
      repoContext: ctx.repoContext,
    });
  }
  ctx.apiKey = ctx.inputs[matchingInputKey]!;
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
