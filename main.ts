import * as core from "@actions/core";
import { ClaudeAgent } from "./agents";

// Expected environment variables that should be passed as inputs
export const EXPECTED_INPUTS: string[] = [
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_INSTALLATION_TOKEN",
];

export interface ExecutionInputs {
  prompt: string;
  anthropic_api_key: string;
  github_token?: string;
  github_installation_token?: string;
}

export interface MainParams {
  inputs: ExecutionInputs;
  env: Record<string, string>;
  cwd: string;
}

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(params: MainParams): Promise<MainResult> {
  try {
    // Extract inputs from params
    const { inputs, env, cwd } = params;

    // Set working directory if different from current
    if (cwd !== process.cwd()) {
      process.chdir(cwd);
    }

    // Set environment variables
    Object.assign(process.env, env);

    core.info(`→ Starting agent run with Claude Code`);

    // Create and install the Claude agent
    const agent = new ClaudeAgent({ apiKey: inputs.anthropic_api_key });
    await agent.install();

    // Execute the agent with the prompt
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
