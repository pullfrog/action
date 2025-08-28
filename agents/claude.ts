import * as core from "@actions/core";
import { executeCommand } from "../utils/exec";
import { createTempFile } from "../utils/files";
import type { Agent, AgentConfig, AgentResult } from "./types";

/**
 * Claude Code agent implementation
 */
export class ClaudeAgent implements Agent {
  private apiKey: string;

  constructor(config: AgentConfig) {
    if (!config.apiKey) {
      throw new Error("Claude agent requires an API key");
    }
    this.apiKey = config.apiKey;
  }

  /**
   * Install Claude Code CLI
   */
  async install(): Promise<void> {
    core.info("Installing Claude Code...");
    try {
      await executeCommand("curl -fsSL https://claude.ai/install.sh | bash -s 1.0.93");
      core.info("Claude Code installed successfully");
    } catch (error) {
      throw new Error(`Failed to install Claude Code: ${error}`);
    }
  }

  /**
   * Execute Claude Code with the given prompt
   */
  async execute(prompt: string): Promise<AgentResult> {
    core.info("Executing Claude Code...");

    try {
      // Create a temporary file for the prompt
      const promptFile = createTempFile(prompt, "prompt.txt");

      // Execute Claude Code with the prompt using proper headless mode
      const command = `$HOME/.local/bin/claude -p "${promptFile}" --output-format json --permission-mode acceptEdits`;
      core.info(`Executing: ${command}`);

      const { stdout, stderr } = await executeCommand(command, {
        ANTHROPIC_API_KEY: this.apiKey,
      });

      if (stderr) {
        core.warning(`Claude Code stderr: ${stderr}`);
      }

      // Parse JSON response from Claude Code
      let claudeResponse: any;
      try {
        claudeResponse = JSON.parse(stdout);
      } catch {
        core.warning("Failed to parse Claude Code JSON response, using raw output");
        claudeResponse = { result: stdout };
      }

      if (claudeResponse.result) {
        core.info("Claude Code output:");
        console.log(claudeResponse.result);
      }

      core.info("Claude Code executed successfully");

      return {
        success: !claudeResponse.is_error,
        output: claudeResponse.result || stdout,
        error: claudeResponse.is_error ? claudeResponse.result : (stderr || undefined),
        metadata: {
          promptFile,
          command,
          session_id: claudeResponse.session_id,
          cost_usd: claudeResponse.total_cost_usd,
          duration_ms: claudeResponse.duration_ms,
          num_turns: claudeResponse.num_turns,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to execute Claude Code: ${errorMessage}`,
      };
    }
  }
}
