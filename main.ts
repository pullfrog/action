import * as core from "@actions/core";
import { ClaudeAgent } from "./agents/claude.ts";

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
    const { inputs, env, cwd } = params;

    if (cwd !== process.cwd()) {
      process.chdir(cwd);
    }

    Object.assign(process.env, env);

    core.info(`→ Starting agent run with Claude Code`);

    const agent = new ClaudeAgent({ apiKey: inputs.anthropic_api_key });
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
