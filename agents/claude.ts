import { access, constants } from "node:fs/promises";
import * as core from "@actions/core";
import { boxString, tableString } from "../utils";
import { spawn } from "../utils/subprocess";
import type { Agent, AgentConfig, AgentResult } from "./types";

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

  // $: ExecaMethod;

  constructor(config: AgentConfig) {
    if (!config.apiKey) {
      throw new Error("Claude agent requires an API key");
    }
    this.apiKey = config.apiKey;
    // Removed execa dependency - using spawn utility instead
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
    // Check if Claude Code is already installed
    if (await this.isClaudeInstalled()) {
      core.info("Claude Code is already installed, skipping installation");
      return;
    }

    core.info("Installing Claude Code...");
    try {
      // Use shell execution to properly handle the pipe
      const result = await spawn({
        cmd: "bash",
        args: [
          "-c",
          "curl -fsSL https://claude.ai/install.sh | bash -s 1.0.93",
        ],
        env: { ANTHROPIC_API_KEY: this.apiKey },
        timeout: 120000, // 2 minute timeout
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Installation failed with exit code ${result.exitCode}: ${result.stderr}`,
        );
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
    // printTable([[prompt]]);

    try {
      // Execute Claude Code with the prompt directly using proper headless mode
      // core.info(`Executing Claude Code with prompt: ${prompt.substring(0, 100)}...`);

      const claudePath = `${process.env.HOME}/.local/bin/claude`;
      // console.log("Using Claude Code from:", claudePath);
      console.log(boxString(prompt, { title: "Prompt" }));
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
      ];
      const env = {
        ANTHROPIC_API_KEY: this.apiKey,
      };

      // Start a collapsible log group for streaming output
      core.startGroup("🔄 Run details");

      // Initialize run statistics
      this.runStats = {
        toolsUsed: 0,
        turns: 0,
        startTime: Date.now(),
      };

      const finalResult = "";
      const totalCost = 0;

      // run Claude Code with the prompt
      const result = await spawn({
        cmd: claudePath,
        args,
        env,
        input: prompt,
        timeout: 10 * 60 * 1000, // 10 minutes
        onStdout: (_chunk) => {
          // console.log(chunk);
          processJSONChunk(_chunk, this);
        },
        onStderr: (_chunk) => {
          if (_chunk.trim()) {
            // core.warning(`[warn] ${chunk}`);
            processJSONChunk(_chunk, this);
          }
        },
      });

      // throw on non-zero exit code
      if (result.exitCode !== 0) {
        throw new Error(
          `Command failed with exit code ${result.exitCode}\n\nStdout: ${result.stdout}\n\nStderr: ${result.stderr}`,
        );
      }

      // Process the complete buffered stdout to extract final results
      // if (result.stdout.trim()) {
      //   const lines = result.stdout.trim().split("\n");
      //   for (const line of lines) {
      //     if (line.trim()) {
      //       const chunkResult = processJsonChunk(line);
      //       if (chunkResult.finalResult) finalResult = chunkResult.finalResult;
      //       if (chunkResult.totalCost) totalCost = chunkResult.totalCost;
      //     }
      //   }
      // }

      // Log run summary
      const duration = Date.now() - this.runStats.startTime;
      core.info(
        `📊 Run Summary: ${this.runStats.toolsUsed} tools used, ${this.runStats.turns} turns, ${duration}ms duration`,
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
      // Ensure group is closed even if error occurs before group is started
      try {
        core.endGroup();
      } catch {
        // Group might not have been started, ignore
      }
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to execute Claude Code: ${errorMessage}`,
      };
    }
  }
}

/**
 * Process a JSON chunk line and extract result data
 */
// function processJsonChunk(line: string): { finalResult?: string; totalCost?: number } {
//   try {
//     const chunk = JSON.parse(line.trim());
//     processJSONChunk(chunk);

//     // Collect final result and cost data
//     if (chunk.type === "result" && chunk.result) {
//       return {
//         finalResult: chunk.result,
//         totalCost: chunk.total_cost_usd || 0,
//       };
//     }
//     return {};
//   } catch {
//     core.debug(`Failed to parse JSON line: ${line}`);
//     return {};
//   }
// }

/**
 * Pretty print a JSON chunk based on its type
 */
function processJSONChunk(chunk: string, agent?: ClaudeAgent): void {
  try {
    // Parse the JSON string first
    console.log(chunk);
    const parsedChunk = JSON.parse(chunk.trim());

    switch (parsedChunk.type) {
      case "system":
        if (parsedChunk.subtype === "init") {
          core.info(`🚀 Starting Claude Code session...`);
          // core.info(`📁 Working directory: ${parsedChunk.cwd}`);
          // core.info(`🔑 Permission mode: ${parsedChunk.permissionMode}`);
          core.info(
            tableString([
              ["model", parsedChunk.model],
              ["cwd", parsedChunk.cwd],
              ["permission_mode", parsedChunk.permissionMode],
              [
                "tools",
                parsedChunk.tools?.length
                  ? `${parsedChunk.tools.length} tools`
                  : "none",
              ],
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
            ]),
          );
        }
        break;

      case "assistant":
        if (parsedChunk.message?.content) {
          // Track turns
          if (agent) {
            agent.runStats.turns++;
          }

          for (const content of parsedChunk.message.content) {
            if (content.type === "text") {
              // Skip empty text content
              if (content.text.trim()) {
                core.info(
                  boxString(content.text.trim(), { title: "Claude Code" }),
                );
              }
            } else if (content.type === "tool_use") {
              // Track tools used
              if (agent) {
                agent.runStats.toolsUsed++;
              }

              // Enhanced tool usage logging
              const toolName = content.name;
              // const toolId = content.id;

              core.info(`→ ${toolName}`);

              // Log tool-specific details based on tool type
              if (content.input) {
                const input = content.input;

                // Common tool input fields
                if (input.description) {
                  core.info(`   └─ ${input.description}`);
                }

                // Tool-specific input fields
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

                // For multi-edit or complex operations
                if (input.edits && Array.isArray(input.edits)) {
                  core.info(`   └─ edits: ${input.edits.length} changes`);
                  input.edits.forEach((edit: any, index: number) => {
                    if (edit.file_path) {
                      core.info(`      ${index + 1}. ${edit.file_path}`);
                    }
                  });
                }

                // For task operations
                if (input.task) {
                  core.info(`   └─ task: ${input.task}`);
                }

                // For bash operations with specific details
                if (input.bash_command) {
                  core.info(`   └─ bash_command: ${input.bash_command}`);
                }
              }

              // Log tool ID for debugging
              // core.debug(`   🔗 Tool ID: ${toolId}`);
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
                // Enhanced tool result logging
                const _resultContent = content.content.trim();
                // do nothing for now. usually useless in headless more.
              }
            }
          }
        }
        break;

      case "result":
        if (parsedChunk.subtype === "success") {
          if (parsedChunk.result) {
            core.info(
              boxString(parsedChunk.result.trim(), {
                title: "🤖 Claude Code",
                maxWidth: 70,
              }),
            );
          }

          core.info(
            tableString([
              [
                "Cost",
                `$${parsedChunk.total_cost_usd?.toFixed(4) || "0.0000"}`,
              ],
              ["Input Tokens", parsedChunk.usage?.input_tokens || 0],
              ["Output Tokens", parsedChunk.usage?.output_tokens || 0],
              ["Duration", `${parsedChunk.duration_ms}ms`],
              ["Turns", parsedChunk.num_turns || 1],
            ]),
          );
        } else {
          core.error(`❌ Failed: ${parsedChunk.error || "Unknown error"}`);
        }
        break;

      default:
        // Log unknown chunk types for debugging
        core.debug(`📦 Unknown chunk type: ${parsedChunk.type}`);
        break;
    }
  } catch (error) {
    core.debug(`Failed to parse chunk: ${error}`);
    core.debug(`Raw chunk: ${chunk.substring(0, 200)}...`);
  }
}
