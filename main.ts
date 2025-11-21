import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { type } from "arktype";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentName, AgentName as AgentNameType, Payload } from "./external.ts";
import { agentsManifest } from "./external.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import { fetchRepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import {
  parseRepoContext,
  type RepoContext,
  revokeInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitBranch, setupGitConfig } from "./utils/setup.ts";

// runtime validation using agents (needed for ArkType)
// Note: The AgentName type is defined in external.ts, this is the runtime validator

const AGENT_OVERRIDE: AgentName | null = "cursor";
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
  const partialCtx = await initializeContext(inputs);
  const ctx = partialCtx as MainContext;

  try {
    // parse payload early to extract agent for determineAgent
    ctx.payload = parsePayload(inputs);
    await determineAgent(ctx);
    setupGitAuth(ctx.githubInstallationToken, ctx.repoContext);
    await setupTempDirectory(ctx);
    setupMcpLogPolling(ctx);

    setupGitBranch(ctx.payload);
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
    await cleanup({
      ...partialCtx,
      payload: ctx.payload,
    });
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
  mcpLogPath: string;
  pollInterval: NodeJS.Timeout | null;
  payload: Payload;
  mcpServers: ReturnType<typeof createMcpConfigs>;
  cliPath: string;
  apiKey: string;
}

async function initializeContext(
  inputs: Inputs
): Promise<Omit<MainContext, "payload" | "mcpServers" | "cliPath" | "apiKey">> {
  log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);
  Inputs.assert(inputs);
  setupGitConfig();

  const githubInstallationToken = await setupGitHubInstallationToken();
  const repoContext = parseRepoContext();

  return {
    inputs,
    githubInstallationToken,
    repoContext,
    agentName: "claude",
    agent: agents.claude,
    sharedTempDir: "",
    mcpLogPath: "",
    pollInterval: null,
  };
}

async function determineAgent(
  ctx: Omit<MainContext, "mcpServers" | "cliPath" | "apiKey">
): Promise<void> {
  const repoSettings = await fetchRepoSettings({
    token: ctx.githubInstallationToken,
    repoContext: ctx.repoContext,
  });

  const configuredAgentName =
    (process.env.NODE_ENV === "development" && AGENT_OVERRIDE) ||
    ctx.payload.agent ||
    repoSettings.defaultAgent ||
    null;

  if (configuredAgentName) {
    ctx.agentName = configuredAgentName;
    ctx.agent = agents[ctx.agentName];
    log.info(`Selected configured agent: ${ctx.agentName}`);
    return;
  }

  const availableAgents = getAvailableAgents(ctx.inputs);
  const availableAgentNames = availableAgents.map((agent) => agent.name).join(", ");
  log.debug(`Available agents: ${availableAgentNames || "none"}`);

  if (availableAgents.length === 0) {
    throwMissingApiKeyError({
      agentName: configuredAgentName,
      inputKeys: getAllPossibleKeyNames(),
      repoContext: ctx.repoContext,
    });
  }

  ctx.agentName = availableAgents[0].name;
  ctx.agent = availableAgents[0];
  log.info(`No agent configured, defaulting to first available agent: ${ctx.agentName}`);
}

async function setupTempDirectory(
  ctx: Omit<MainContext, "payload" | "mcpServers" | "cliPath" | "apiKey">
): Promise<void> {
  ctx.sharedTempDir = await mkdtemp(join(tmpdir(), "pullfrog-"));
  process.env.PULLFROG_TEMP_DIR = ctx.sharedTempDir;
  ctx.mcpLogPath = join(ctx.sharedTempDir, "mcpLog.txt");
  await writeFile(ctx.mcpLogPath, "", "utf-8");
  log.info(`📂 PULLFROG_TEMP_DIR has been created at ${ctx.sharedTempDir}`);
}

function setupMcpLogPolling(ctx: MainContext): void {
  let lastSize = 0;
  ctx.pollInterval = setInterval(() => {
    if (existsSync(ctx.mcpLogPath)) {
      const content = readFileSync(ctx.mcpLogPath, "utf-8");
      if (content.length > lastSize) {
        const newContent = content.slice(lastSize);
        process.stdout.write(newContent);
        lastSize = content.length;
      }
    }
  }, 100);
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

function setupMcpServers(ctx: MainContext): void {
  const allModes = [...modes, ...(ctx.payload.modes || [])];
  ctx.mcpServers = createMcpConfigs(ctx.githubInstallationToken, allModes, ctx.payload);
  log.debug(`📋 MCP Config: ${JSON.stringify(ctx.mcpServers, null, 2)}`);
}

async function installAgentCli(ctx: MainContext): Promise<void> {
  ctx.cliPath = await ctx.agent.install();
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
  log.box(ctx.payload.prompt, { title: "Prompt" });

  return ctx.agent.run({
    payload: ctx.payload,
    mcpServers: ctx.mcpServers,
    githubInstallationToken: ctx.githubInstallationToken,
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

async function cleanup(ctx: Omit<MainContext, "mcpServers" | "cliPath" | "apiKey">): Promise<void> {
  if (ctx.pollInterval) {
    clearInterval(ctx.pollInterval);
  }
  await revokeInstallationToken(ctx.githubInstallationToken);
}
