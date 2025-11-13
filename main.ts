import { type } from "arktype";
import { agents } from "./agents/index.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import packageJson from "./package.json" with { type: "json" };
import { fetchRepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import {
  parseRepoContext,
  revokeInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitConfig } from "./utils/setup.ts";

export const AgentName = type.enumerated("codex", "claude");
export type AgentName = typeof AgentName.infer;

export const Inputs = type({
  prompt: "string",
  "anthropic_api_key?": "string | undefined",
  "openai_api_key?": "string | undefined",
  "agent?": AgentName,
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

    Inputs.assert(inputs);
    setupGitConfig();

    const { githubInstallationToken, wasAcquired } = await setupGitHubInstallationToken();
    if (wasAcquired) {
      tokenToRevoke = githubInstallationToken;
    }
    const repoContext = parseRepoContext();

    const repoSettings = await fetchRepoSettings({
      token: githubInstallationToken,
      repoContext,
    });

    const agentName: AgentName = inputs.agent || repoSettings.defaultAgent || "claude";

    const agent = agents[agentName];

    setupGitAuth(githubInstallationToken, repoContext);

    const mcpServers = createMcpConfigs(githubInstallationToken);

    log.debug(`📋 MCP Config: ${JSON.stringify(mcpServers, null, 2)}`);

    // Install agent CLI before running
    const cliPath = await agent.install();

    log.info(`Running ${agentName} Agent SDK...`);
    log.box(inputs.prompt, { title: "Prompt" });

    // TODO: check if `inputs.prompts` is JSON
    // if yes, check if it's a webhook payload or toJSON(github.event)
    // for webhook payloads, check the specified `agent` field

    // Get API key based on agent type
    let apiKey: string;
    if (agentName === "claude") {
      if (!inputs.anthropic_api_key) {
        throw new Error("ANTHROPIC_API_KEY is required for Claude agent");
      }
      apiKey = inputs.anthropic_api_key;
    } else if (agentName === "codex") {
      if (!inputs.openai_api_key) {
        throw new Error("OPENAI_API_KEY is required for Codex agent");
      }
      apiKey = inputs.openai_api_key;
    } else {
      throw new Error(`API key configuration not implemented for agent: ${agentName}`);
    }

    const result = await agent.run({
      prompt: inputs.prompt,
      mcpServers,
      githubInstallationToken,
      apiKey,
      cliPath,
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
