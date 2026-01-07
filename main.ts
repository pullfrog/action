import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { Octokit } from "@octokit/rest";
import { encode as toonEncode } from "@toon-format/toon";
import { type } from "arktype";
import { type Agent, agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentName, Payload } from "./external.ts";
import { agentsManifest } from "./external.ts";
import { ensureProgressCommentUpdated, reportProgress } from "./mcp/comment.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { startMcpHttpServer } from "./mcp/server.ts";
import { getModes, type Mode, modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import type { PrepResult } from "./prep/index.ts";
import { fetchRepoSettings, fetchWorkflowRunInfo, type RepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import { reportErrorToComment } from "./utils/errorReport.ts";
import {
  createOctokit,
  parseRepoContext,
  revokeGitHubInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitConfig } from "./utils/setup.ts";
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

// intermediate result types for deterministic context building
interface GitHubSetup {
  token: string;
  owner: string;
  name: string;
  octokit: Octokit;
  repo: Awaited<ReturnType<Octokit["repos"]["get"]>>["data"];
  repoSettings: RepoSettings;
}

type ApiKeySetup =
  | { success: true; apiKey: string; apiKeys: Record<string, string> }
  | { success: false; error: string };

export async function main(inputs: Inputs): Promise<MainResult> {
  let mcpServerClose: (() => Promise<void>) | undefined;
  let payload: Payload | undefined;

  try {
    const timer = new Timer();

    // phase 1: parse and validate inputs
    payload = parsePayload(inputs);
    Inputs.assert(inputs);
    setupGitConfig();

    // phase 2: fast setup (github + temp dir)
    const [githubSetup, sharedTempDir] = await Promise.all([
      initializeGitHub(),
      createTempDirectory(),
    ]);
    timer.checkpoint("githubSetup");

    // phase 3: resolve agent (needs repo settings)
    const agent = resolveAgent({
      inputs,
      payload,
      repoSettings: githubSetup.repoSettings,
    });
    const resolvedPayload = { ...payload, agent: agent.name };

    // phase 4: validate API key (sync, needs agent) - fail fast before long-running operations
    const apiKeySetup = validateApiKey({
      agent,
      inputs,
      owner: githubSetup.owner,
      name: githubSetup.name,
    });
    if (!apiKeySetup.success) {
      await reportErrorToComment({ error: apiKeySetup.error });
      return { success: false, error: apiKeySetup.error };
    }

    // phase 5: parallel long-running operations (agent install + git auth)
    const toolState: ToolState = {};
    const [cliPath] = await Promise.all([
      installAgentCli({ agent, token: githubSetup.token }),
      setupGitAuth({
        token: githubSetup.token,
        owner: githubSetup.owner,
        name: githubSetup.name,
        payload: resolvedPayload,
        octokit: githubSetup.octokit,
        toolState,
      }),
    ]);
    timer.checkpoint("agentSetup+gitAuth");

    // phase 6: compute modes
    const computedModes: Mode[] = [
      ...getModes({
        disableProgressComment: resolvedPayload.disableProgressComment,
      }),
      ...(resolvedPayload.modes || []),
    ];

    // phase 7: compute runId/jobId for MCP tools
    const runId = process.env.GITHUB_RUN_ID || "";
    if (runId) {
      const workflowRunInfo = await fetchWorkflowRunInfo(runId);
      if (workflowRunInfo.progressCommentId) {
        process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
        log.info(`📝 Using pre-created progress comment: ${workflowRunInfo.progressCommentId}`);
      }
    }

    let jobId: string | undefined;
    const jobName = process.env.GITHUB_JOB;
    if (jobName && runId) {
      const jobs = await githubSetup.octokit.rest.actions.listJobsForWorkflowRun({
        owner: githubSetup.owner,
        repo: githubSetup.name,
        run_id: parseInt(runId, 10),
      });
      const matchingJob = jobs.data.jobs.find((job) => job.name === jobName);
      if (matchingJob) {
        jobId = String(matchingJob.id);
        log.info(`📋 Found job ID: ${jobId}`);
      }
    }

    // phase 8: build tool context and start MCP server
    const toolContext: ToolContext = {
      owner: githubSetup.owner,
      name: githubSetup.name,
      githubInstallationToken: githubSetup.token,
      octokit: githubSetup.octokit,
      payload: resolvedPayload,
      repo: githubSetup.repo,
      repoSettings: githubSetup.repoSettings,
      modes: computedModes,
      toolState,
      agent,
      sharedTempDir,
      runId,
      jobId,
    };

    const { url: mcpServerUrl, close: mcpServerCloseFunc } = await startMcpHttpServer(toolContext);
    mcpServerClose = mcpServerCloseFunc;
    log.info(`🚀 MCP server started at ${mcpServerUrl}`);

    const mcpServers = createMcpConfigs(mcpServerUrl);
    log.debug(`📋 MCP Config: ${JSON.stringify(mcpServers, null, 2)}`);
    timer.checkpoint("mcpServer");

    // BUILD FINAL IMMUTABLE CONTEXT
    const ctx: AgentContext = {
      ...toolContext,
      inputs,
      mcpServerUrl,
      mcpServerClose: mcpServerCloseFunc,
      mcpServers,
      cliPath,
      apiKey: apiKeySetup.apiKey,
      apiKeys: apiKeySetup.apiKeys,
    };

    // check for empty comment_ids in fix_review trigger - report and exit early
    if (
      ctx.payload.event.trigger === "fix_review" &&
      Array.isArray(ctx.payload.event.comment_ids) &&
      ctx.payload.event.comment_ids.length === 0
    ) {
      const noThumbsMessage = `👍 **No approved comments found**\n\nTo use "Fix 👍s", add a 👍 reaction to one or more inline review comments you want fixed.`;
      log.error(noThumbsMessage);
      await reportProgress(ctx, { body: noThumbsMessage });
      return { success: true };
    }

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
/**
 * Check if an agent has API keys available (inputs or process.env for opencode)
 */
function agentHasApiKeys(agent: Agent, inputs: Inputs): boolean {
  if (agent.name === "opencode") {
    // check inputs first, then process.env
    const hasInputKey = Object.keys(inputs).some((key) => key.includes("api_key"));
    if (hasInputKey) return true;
    return Object.keys(process.env).some((key) => key.includes("API_KEY") && process.env[key]);
  }
  const inputsRecord = inputs as Record<string, string | undefined>;
  return agent.apiKeyNames.some((inputKey) => inputsRecord[inputKey]);
}

function getAvailableAgents(inputs: Inputs): Agent[] {
  return Object.values(agents).filter((agent) => agentHasApiKeys(agent, inputs));
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
 * Build a helpful error message for missing API key with links to repo settings
 */
function buildMissingApiKeyError(params: { agent: Agent; owner: string; name: string }): string {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const settingsUrl = `${apiUrl}/console/${params.owner}/${params.name}`;

  const githubRepoUrl = `https://github.com/${params.owner}/${params.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  // for OpenCode, use a generic message since it accepts any API key
  const isOpenCode = params.agent.name === "opencode";
  let secretNameList: string;
  if (isOpenCode) {
    secretNameList =
      "any API key (e.g., `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)";
  } else {
    const inputKeys =
      params.agent.apiKeyNames.length > 0 ? params.agent.apiKeyNames : getAllPossibleKeyNames();
    const secretNames = inputKeys.map((key) => `\`${key.toUpperCase()}\``);
    secretNameList = inputKeys.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;
  }

  return `Pullfrog is configured to use ${params.agent.displayName}, but the associated API key was not provided.

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"

Alternatively, configure Pullfrog to use a different agent at ${settingsUrl}`;
}

// tool context - subset of Context needed by MCP tools
export interface ToolContext {
  owner: string;
  name: string;
  githubInstallationToken: string;
  octokit: Octokit;
  payload: Payload;
  repo: Awaited<ReturnType<Octokit["repos"]["get"]>>["data"];
  repoSettings: RepoSettings;
  modes: Mode[];
  toolState: ToolState;
  agent: Agent;
  sharedTempDir: string;
  runId: string;
  jobId: string | undefined;
}

export interface AgentContext extends Readonly<ToolContext> {
  readonly inputs: Inputs;
  readonly mcpServerUrl: string;
  readonly mcpServerClose: () => Promise<void>;
  readonly mcpServers: ReturnType<typeof createMcpConfigs>;
  readonly cliPath: string;
  readonly apiKey: string;
  readonly apiKeys: Record<string, string>;
}

export interface DependencyInstallationState {
  status: "not_started" | "in_progress" | "completed" | "failed";
  promise: Promise<PrepResult[]> | undefined;
  results: PrepResult[] | undefined;
}

export interface ToolState {
  prNumber?: number;
  issueNumber?: number;
  selectedMode?: string;
  review?: {
    id: number; // REST API database ID (for fix URLs)
    nodeId: string; // GraphQL node ID (for mutations)
  };
  dependencyInstallation?: DependencyInstallationState;
}

/**
 * Initialize GitHub connection: token, octokit, repo data, settings
 */
async function initializeGitHub(): Promise<GitHubSetup> {
  log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);

  const token = await setupGitHubInstallationToken();
  const { owner, name } = parseRepoContext();

  const octokit = createOctokit(token);

  // fetch repo data and settings in parallel
  const [repoResponse, repoSettings] = await Promise.all([
    octokit.repos.get({ owner, repo: name }),
    fetchRepoSettings({ token, repoContext: { owner, name } }),
  ]);

  return {
    token,
    owner,
    name,
    octokit,
    repo: repoResponse.data,
    repoSettings,
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
}): Agent {
  const agentOverride = process.env.AGENT_OVERRIDE as AgentName | undefined;
  const configuredAgentName = agentOverride || payload.agent || repoSettings.defaultAgent || null;

  if (configuredAgentName) {
    const agent = agents[configuredAgentName];
    if (!agent) {
      throw new Error(`invalid agent name: ${configuredAgentName}`);
    }

    // if explicitly configured (via override or payload), respect it even without matching keys
    // this allows users to force an agent selection (will fail later with clear error if no keys)
    const isExplicitOverride = agentOverride !== undefined || payload.agent !== null;
    if (isExplicitOverride) {
      log.info(`Selected configured agent: ${agent.name}`);
      return agent;
    }

    // for repo-level defaults, check if agent has matching keys before selecting
    if (agentHasApiKeys(agent, inputs)) {
      log.info(`Selected configured agent: ${agent.name}`);
      return agent;
    }

    // fall through to auto-selection
    const availableAgents = getAvailableAgents(inputs);
    log.warning(
      `Repo default agent ${agent.name} has no matching API keys. Available: ${
        availableAgents.map((a) => a.name).join(", ") || "none"
      }`
    );
  }

  const availableAgents = getAvailableAgents(inputs);
  if (availableAgents.length === 0) {
    throw new Error("no agents available - missing API keys");
  }

  const agent = availableAgents[0];
  log.info(`No agent configured, defaulting to first available agent: ${agent.name}`);
  return agent;
}

async function createTempDirectory(): Promise<string> {
  const sharedTempDir = await mkdtemp(join(tmpdir(), "pullfrog-"));
  process.env.PULLFROG_TEMP_DIR = sharedTempDir;
  log.info(`📂 PULLFROG_TEMP_DIR has been created at ${sharedTempDir}`);
  return sharedTempDir;
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

async function installAgentCli(params: { agent: Agent; token: string }): Promise<string> {
  // gemini is the only agent that needs githubInstallationToken for install
  if (params.agent.name === "gemini") {
    return params.agent.install(params.token);
  }
  return params.agent.install();
}

function collectApiKeys(agent: Agent, inputs: Inputs): Record<string, string> {
  const apiKeys: Record<string, string> = {};
  const inputsRecord = inputs as Record<string, string | undefined>;

  for (const inputKey of agent.apiKeyNames) {
    const value = inputsRecord[inputKey];
    if (value) {
      apiKeys[inputKey] = value;
    }
  }

  // for OpenCode: also check process.env for any API_KEY variables
  if (agent.name === "opencode" && Object.keys(apiKeys).length === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && key.includes("API_KEY")) {
        apiKeys[key.toLowerCase()] = value;
      }
    }
  }

  return apiKeys;
}

function validateApiKey(params: {
  agent: Agent;
  inputs: Inputs;
  owner: string;
  name: string;
}): ApiKeySetup {
  const apiKeys = collectApiKeys(params.agent, params.inputs);

  if (Object.keys(apiKeys).length === 0) {
    return {
      success: false,
      error: buildMissingApiKeyError({
        agent: params.agent,
        owner: params.owner,
        name: params.name,
      }),
    };
  }

  return {
    success: true,
    apiKey: Object.values(apiKeys)[0],
    apiKeys,
  };
}

async function runAgent(ctx: AgentContext): Promise<AgentResult> {
  log.info(`Running ${ctx.agent.name}...`);
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
