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

      // Execute Claude Code with the prompt
      const command = `$HOME/.local/bin/claude --dangerously-skip-permissions "${promptFile}"`;
      core.info(`Executing: ${command}`);

      const { stdout, stderr } = await executeCommand(command, {
        ANTHROPIC_API_KEY: this.apiKey,
      });

      if (stderr) {
        core.warning(`Claude Code stderr: ${stderr}`);
      }

      if (stdout) {
        core.info("Claude Code output:");
        console.log(stdout);
      }

      core.info("Claude Code executed successfully");

      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        metadata: {
          promptFile,
          command,
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
