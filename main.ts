import { type } from "arktype";
import { claude } from "./agents/claude.ts";
import { codex } from "./agents/codex.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import packageJson from "./package.json" with { type: "json" };
import { DEFAULT_REPO_SETTINGS, getRepoSettings, type RepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import {
  parseRepoContext,
  revokeInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitConfig } from "./utils/setup.ts";

export const Inputs = type({
  prompt: "string",
  "anthropic_api_key?": "string | undefined",
  "openai_api_key?": "string | undefined",
  "agent?": "string | undefined",
});

export type Inputs = typeof Inputs.infer;

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export type PromptJSON = {};

export async function main(inputs: Inputs): Promise<MainResult> {
  let tokenToRevoke: string | null = null;

  try {
    log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);

    setupGitConfig();

    const { githubInstallationToken, wasAcquired, isFallbackToken } =
      await setupGitHubInstallationToken();
    if (wasAcquired) {
      tokenToRevoke = githubInstallationToken;
    }
    const repoContext = parseRepoContext();

    // Fetch repo settings (agent, permissions, workflows) from API
    // Skip API call if we're using GITHUB_TOKEN fallback (app not installed)
    let repoSettings: RepoSettings;
    if (isFallbackToken) {
      log.info("Using default repository settings (app not installed)");
      repoSettings = DEFAULT_REPO_SETTINGS;
    } else {
      log.info("Fetching repository settings...");
      repoSettings = await getRepoSettings(githubInstallationToken, repoContext);
      log.info("Repository settings fetched");
    }
    // Use agent from inputs if provided, otherwise use repo settings, default to claude
    const agent = inputs.agent || repoSettings.defaultAgent || "claude";
    
    // Agent registry
    const agents = {
      claude,
      codex,
    } as const;

    if (!(agent in agents)) {
      throw new Error(`Unsupported agent: ${agent}. Supported agents: ${Object.keys(agents).join(", ")}`);
    }

    const agentImpl = agents[agent as keyof typeof agents];

    setupGitAuth(githubInstallationToken, repoContext);

    const mcpServers = createMcpConfigs(githubInstallationToken);

    log.debug(`📋 MCP Config: ${JSON.stringify(mcpServers, null, 2)}`);

    // Install agent CLI before running
    await agentImpl.install();

    log.info(`Running ${agent} Agent SDK...`);
    log.box(inputs.prompt, { title: "Prompt" });

    // TODO: check if `inputs.prompts` is JSON
    // if yes, check if it's a webhook payload or toJSON(github.event)
    // for webhook payloads, check the specified `agent` field

    // Get API key based on agent type
    let apiKey: string;
    if (agent === "claude") {
      if (!inputs.anthropic_api_key) {
        throw new Error("ANTHROPIC_API_KEY is required for Claude agent");
      }
      apiKey = inputs.anthropic_api_key;
    } else if (agent === "codex") {
      if (!inputs.openai_api_key) {
        throw new Error("OPENAI_API_KEY is required for Codex agent");
      }
      apiKey = inputs.openai_api_key;
    } else {
      throw new Error(`API key configuration not implemented for agent: ${agent}`);
    }

    const result = await agentImpl.run({
      prompt: inputs.prompt,
      mcpServers,
      githubInstallationToken,
      apiKey,
    });

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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    await log.writeSummary();
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (tokenToRevoke) {
      await revokeInstallationToken(tokenToRevoke);
    }
  }
}
