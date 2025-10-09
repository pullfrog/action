import { readFileSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import * as core from "@actions/core";
import { createMcpConfig } from "../mcp/config.ts";
import { spawn } from "../utils/subprocess.ts";
import { boxString, tableString } from "../utils/table.ts";
import type { Agent, AgentConfig, AgentResult } from "./types.ts";

/**
 * Claude Code agent implementation
 */
export class ClaudeAgent implements Agent {
  private apiKey: string;
  public runStats = {
    toolsUsed: 0,
    turns: 0,
    startTime: 0,
  };

  constructor(config: AgentConfig) {
    if (!config.apiKey) {
      throw new Error("Claude agent requires an API key");
    }
    this.apiKey = config.apiKey;
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
   * Execute Claude Code with the given prompt
   */
  async execute(prompt: string): Promise<AgentResult> {
    core.info("Running Claude Code...");

    try {
      const claudePath = `${process.env.HOME}/.local/bin/claude`;
      console.log(boxString(prompt, { title: "Prompt" }));
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
      ];

      if (!process.env.GITHUB_INSTALLATION_TOKEN) {
        throw new Error("GITHUB_INSTALLATION_TOKEN is required for GitHub integration");
      }

      const mcpConfig = createMcpConfig(process.env.GITHUB_INSTALLATION_TOKEN);
      console.log("📋 MCP Config:", mcpConfig);
      args.push("--mcp-config", mcpConfig);

      const env = {
        ANTHROPIC_API_KEY: this.apiKey,
      };

      core.startGroup("🔄 Run details");

      this.runStats = {
        toolsUsed: 0,
        turns: 0,
        startTime: Date.now(),
      };

      const finalResult = "";
      const totalCost = 0;

      const result = await spawn({
        cmd: claudePath,
        args,
        env,
        input: prompt,
        timeout: 10 * 60 * 1000, // 10 minutes
        onStdout: (_chunk) => {
          processJSONChunk(_chunk, this);
        },
        onStderr: (_chunk) => {
          if (_chunk.trim()) {
            processJSONChunk(_chunk, this);
          }
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Command failed with exit code ${result.exitCode}\n\nStdout: ${result.stdout}\n\nStderr: ${result.stderr}`
        );
      }

      const duration = Date.now() - this.runStats.startTime;
      core.info(
        `📊 Run Summary: ${this.runStats.toolsUsed} tools used, ${this.runStats.turns} turns, ${duration}ms duration`
      );

      core.info("✅ Task complete.");
      core.endGroup(); // End the collapsible log group

      return {
        success: true,
        output: finalResult,
        metadata: {
          promptLength: prompt.length,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          totalCost,
        },
      };
    } catch (error: any) {
      try {
        core.endGroup();
      } catch {}
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to execute Claude Code: ${errorMessage}`,
      };
    }
  }
}

/**
 * Pretty print a JSON chunk based on its type
 */
function processJSONChunk(chunk: string, agent?: ClaudeAgent): void {
  try {
    console.log(chunk);
    const parsedChunk = JSON.parse(chunk.trim());

    switch (parsedChunk.type) {
      case "system":
        if (parsedChunk.subtype === "init") {
          core.info(`🚀 Starting Claude Code session...`);
          core.info(
            tableString([
              ["model", parsedChunk.model],
              ["cwd", parsedChunk.cwd],
              ["permission_mode", parsedChunk.permissionMode],
              ["tools", parsedChunk.tools?.length ? `${parsedChunk.tools.length} tools` : "none"],
              [
                "mcp_servers",
                parsedChunk.mcp_servers?.length
                  ? `${parsedChunk.mcp_servers.length} servers`
                  : "none",
              ],
              [
                "slash_commands",
                parsedChunk.slash_commands?.length
                  ? `${parsedChunk.slash_commands.length} commands`
                  : "none",
              ],
            ])
          );

          // Check for failed MCP servers and show debug logs
          if (parsedChunk.mcp_servers?.length > 0) {
            const failedServers = parsedChunk.mcp_servers.filter(
              (server: any) => server.status === "failed"
            );
            if (failedServers.length > 0) {
              const failedNames = failedServers.map((server: any) => server.name).join(", ");

              // Try to read MCP server debug logs
              let debugInfo = "";
              try {
                const logContent = readFileSync("/tmp/mcp-server.log", "utf-8");
                core.error("MCP Server Debug Log:");
                core.error(logContent);
                debugInfo = " (see debug log above)";
              } catch (logError) {
                debugInfo = ` (could not read debug log: ${logError instanceof Error ? logError.message : String(logError)})`;
              }

              throw new Error(`MCP servers failed to start: ${failedNames}${debugInfo}`);
            }
          }
        }
        break;

      case "assistant":
        if (parsedChunk.message?.content) {
          if (agent) {
            agent.runStats.turns++;
          }

          for (const content of parsedChunk.message.content) {
            if (content.type === "text") {
              if (content.text.trim()) {
                core.info(boxString(content.text.trim(), { title: "Claude Code" }));
              }
            } else if (content.type === "tool_use") {
              if (agent) {
                agent.runStats.toolsUsed++;
              }

              const toolName = content.name;

              core.info(`→ ${toolName}`);

              if (content.input) {
                const input = content.input;

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
        break;

      case "user":
        if (parsedChunk.message?.content) {
          for (const content of parsedChunk.message.content) {
            if (content.type === "tool_result") {
              if (content.is_error) {
                core.warning(`❌ Tool error: ${content.content}`);
              } else {
              }
            }
          }
        }
        break;

      case "result":
        if (parsedChunk.subtype === "success") {
          core.info(
            tableString([
              ["Cost", `$${parsedChunk.total_cost_usd?.toFixed(4) || "0.0000"}`],
              ["Input Tokens", parsedChunk.usage?.input_tokens || 0],
              ["Output Tokens", parsedChunk.usage?.output_tokens || 0],
              ["Duration", `${parsedChunk.duration_ms}ms`],
              ["Turns", parsedChunk.num_turns || 1],
            ])
          );
        } else {
          core.error(`❌ Failed: ${parsedChunk.error || "Unknown error"}`);
        }
        break;

      default:
        core.debug(`📦 Unknown chunk type: ${parsedChunk.type}`);
        break;
    }
  } catch (error) {
    core.debug(`Failed to parse chunk: ${error}`);
    core.debug(`Raw chunk: ${chunk.substring(0, 200)}...`);
  }
}
