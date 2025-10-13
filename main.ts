import * as core from "@actions/core";
import { type } from "arktype";
import { ClaudeAgent } from "./agents/claude.ts";
import { setupGitHubInstallationToken } from "./utils/github.ts";

export const Inputs = type({
  prompt: "string",
  "anthropic_api_key?": "string | undefined",
});

export type ActionInputs = typeof Inputs.infer;

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(inputs: ActionInputs): Promise<MainResult> {
  try {
    core.info(`→ Starting agent run with Claude Code`);

    // Setup GitHub installation token
    const githubInstallationToken = await setupGitHubInstallationToken();

    const agent = new ClaudeAgent({ 
      apiKey: inputs.anthropic_api_key!,
      githubInstallationToken
    });
    await agent.install();

    const result = await agent.execute(inputs.prompt);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Agent execution failed",
        output: result.output!,
      };
    }

    return {
      success: true,
      output: result.output || "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: errorMessage,
    };
  }
}
