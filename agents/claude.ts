import { access, constants } from "node:fs/promises";
import * as core from "@actions/core";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createMcpConfig } from "../mcp/config.ts";
import { debugLog, isDebug } from "../utils/logging.ts";
import { spawn } from "../utils/subprocess.ts";
import { boxString, tableString } from "../utils/table.ts";
import { instructions } from "./shared.ts";
import type { Agent, AgentConfig, AgentResult } from "./types.ts";

/**
 * Claude Code agent implementation
 */
export class ClaudeAgent implements Agent {
  private apiKey: string;
  private githubInstallationToken: string;
  public runStats = {
    toolsUsed: 0,
    turns: 0,
    startTime: 0,
  };

  constructor(config: AgentConfig) {
    this.apiKey = config.apiKey;
    this.githubInstallationToken = config.githubInstallationToken;
  }

  /**
   * Check if Claude Code CLI is already installed
   */
  private async isClaudeInstalled(): Promise<boolean> {
    try {
      const claudePath = `${process.env.HOME}/.local/bin/claude`;
      await access(claudePath, constants.F_OK | constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install Claude Code CLI
   */
  async install(): Promise<void> {
    if (await this.isClaudeInstalled()) {
      core.info("Claude Code is already installed, skipping installation");
      return;
    }

    core.info("Installing Claude Code...");
    try {
      const result = await spawn({
        cmd: "bash",
        args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash -s 1.0.93"],
        env: { ANTHROPIC_API_KEY: this.apiKey },
        timeout: 120000, // 2 minute timeout
        onStdout: () => {},
        onStderr: (chunk) => process.stderr.write(chunk),
      });

      if (result.exitCode !== 0) {
        throw new Error(`Installation failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      core.info("Claude Code installed successfully");
    } catch (error) {
      throw new Error(`Failed to install Claude Code: ${error}`);
    }
  }

  /**
   * Execute Claude Code with the given prompt using the SDK
   */
  async execute(prompt: string): Promise<AgentResult> {
    core.info("Running Claude Agent SDK...");

    console.log(boxString(prompt, { title: "Prompt" }));

    const mcpConfig = JSON.parse(createMcpConfig(this.githubInstallationToken));

    if (isDebug()) {
      debugLog(`📋 MCP Config: ${JSON.stringify(mcpConfig, null, 2)}`);
    }

    core.startGroup("🔄 Run details");

    this.runStats = {
      toolsUsed: 0,
      turns: 0,
      startTime: Date.now(),
    };

    let finalOutput = "";

    // Initialize session
    core.info(`🚀 Starting Claude Agent SDK session...`);

    // Set API key environment variable for SDK
    process.env.ANTHROPIC_API_KEY = this.apiKey;

    // Create the query with SDK options
    const queryInstance = query({
      prompt: `${instructions}\n\n${prompt}`,
      options: {
        permissionMode: "bypassPermissions",
        mcpServers: mcpConfig.mcpServers,
      },
    });

    // Stream the results
    for await (const message of queryInstance) {
      if (message.type === "assistant") {
        this.runStats.turns++;

        // Handle assistant messages with content
        if (message.message?.content) {
          for (const content of message.message.content) {
            if (content.type === "text" && content.text?.trim()) {
              core.info(boxString(content.text.trim(), { title: "Claude" }));
              finalOutput += content.text + "\n";
            } else if (content.type === "tool_use") {
              this.runStats.toolsUsed++;
              const toolName = content.name;
              core.info(`→ ${toolName}`);

              if (content.input) {
                const input = content.input as any;

                if (input.description) {
                  core.info(`   └─ ${input.description}`);
                }
                if (input.command) {
                  core.info(`   └─ command: ${input.command}`);
                }
                if (input.file_path) {
                  core.info(`   └─ file: ${input.file_path}`);
                }
                if (input.content) {
                  const contentPreview =
                    input.content.length > 100
                      ? `${input.content.substring(0, 100)}...`
                      : input.content;
                  core.info(`   └─ content: ${contentPreview}`);
                }
                if (input.query) {
                  core.info(`   └─ query: ${input.query}`);
                }
                if (input.pattern) {
                  core.info(`   └─ pattern: ${input.pattern}`);
                }
                if (input.url) {
                  core.info(`   └─ url: ${input.url}`);
                }
                if (input.edits && Array.isArray(input.edits)) {
                  core.info(`   └─ edits: ${input.edits.length} changes`);
                  input.edits.forEach((edit: any, index: number) => {
                    if (edit.file_path) {
                      core.info(`      ${index + 1}. ${edit.file_path}`);
                    }
                  });
                }
                if (input.task) {
                  core.info(`   └─ task: ${input.task}`);
                }
                if (input.bash_command) {
                  core.info(`   └─ bash_command: ${input.bash_command}`);
                }
              }
            }
          }
        }
      } else if (message.type === "user") {
        // Handle tool results
        if (message.message?.content) {
          for (const content of message.message.content) {
            if (content.type === "tool_result" && content.is_error) {
              core.warning(`❌ Tool error: ${content.content}`);
            }
          }
        }
      } else if (message.type === "result") {
        // Handle final results with usage information
        if (message.subtype === "success") {
          const duration = Date.now() - this.runStats.startTime;
          core.info(
            tableString([
              ["Cost", `$${message.total_cost_usd?.toFixed(4) || "0.0000"}`],
              ["Input Tokens", message.usage?.input_tokens || 0],
              ["Output Tokens", message.usage?.output_tokens || 0],
              ["Duration", `${duration}ms`],
              ["Turns", this.runStats.turns],
            ])
          );
        } else {
          core.error(`❌ Failed: ${JSON.stringify(message)}`);
        }
      }
    }

    core.info("✅ Task complete.");
    core.endGroup();

    return {
      success: true,
      output: finalOutput,
    };
  }
}
