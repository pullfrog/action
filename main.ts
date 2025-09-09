import * as core from "@actions/core";
import { ClaudeAgent } from "./agents";

export interface MainParams {
  prompt: string;
  anthropicApiKey?: string;
}

export interface MainResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function main(params: MainParams): Promise<MainResult> {
  try {
    // Use provided API key or fall back to environment variable
    const anthropicApiKey =
      params.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

    if (!anthropicApiKey) {
      throw new Error("anthropic_api_key is required");
    }

    core.info(`→ Starting agent run with Claude Code`);

    // Create and install the Claude agent
    const agent = new ClaudeAgent({ apiKey: anthropicApiKey });
    await agent.install();

    // Execute the agent with the prompt
    const result = await agent.execute(params.prompt);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Agent execution failed",
        output: result.output,
      };
    }

    return {
      success: true,
      output: result.output || "",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: errorMessage,
    };
  }
}
