import { spawnSync } from "node:child_process";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromGithub } from "./shared.ts";

// gemini cli event types inferred from stream-json output (NDJSON format)
interface GeminiInitEvent {
  type: "init";
  timestamp?: string;
  session_id?: string;
  model?: string;
  [key: string]: unknown;
}

interface GeminiMessageEvent {
  type: "message";
  timestamp?: string;
  role?: "user" | "assistant";
  content?: string;
  delta?: boolean;
  [key: string]: unknown;
}

interface GeminiToolUseEvent {
  type: "tool_use";
  timestamp?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

interface GeminiToolResultEvent {
  type: "tool_result";
  timestamp?: string;
  tool_id?: string;
  status?: "success" | "error";
  output?: string;
  [key: string]: unknown;
}

interface GeminiResultEvent {
  type: "result";
  timestamp?: string;
  status?: "success" | "error";
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
    tool_calls?: number;
  };
  [key: string]: unknown;
}

type GeminiEvent =
  | GeminiInitEvent
  | GeminiMessageEvent
  | GeminiToolUseEvent
  | GeminiToolResultEvent
  | GeminiResultEvent;

let assistantMessageBuffer = "";

const messageHandlers = {
  init: (_event: GeminiInitEvent) => {
    // initialization event - no logging needed
    assistantMessageBuffer = "";
  },
  message: (event: GeminiMessageEvent) => {
    if (event.role === "assistant" && event.content?.trim()) {
      if (event.delta) {
        // accumulate delta messages
        assistantMessageBuffer += event.content;
      } else {
        // final message - log it
        const message = event.content.trim();
        if (message) {
          log.box(message, { title: "Gemini" });
        }
        assistantMessageBuffer = "";
      }
    } else if (event.role === "assistant" && !event.delta && assistantMessageBuffer.trim()) {
      // if we have buffered content and get a non-delta message, log the buffer
      log.box(assistantMessageBuffer.trim(), { title: "Gemini" });
      assistantMessageBuffer = "";
    }
  },
  tool_use: (event: GeminiToolUseEvent) => {
    if (event.tool_name) {
      // log intent for create_working_comment
      if (event.tool_name === "create_working_comment" && event.parameters) {
        const params = event.parameters as { intent?: string; [key: string]: unknown };
        if (params.intent) {
          log.box(params.intent.trim(), { title: "Intent" });
        }
      }

      log.toolCall({
        toolName: event.tool_name,
        input: event.parameters || {},
      });
    }
  },
  tool_result: (event: GeminiToolResultEvent) => {
    if (event.status === "error") {
      const errorMsg =
        typeof event.output === "string" ? event.output : JSON.stringify(event.output);
      log.warning(`Tool call failed: ${errorMsg}`);
    }
  },
  result: async (event: GeminiResultEvent) => {
    // log any remaining buffered assistant message
    if (assistantMessageBuffer.trim()) {
      log.box(assistantMessageBuffer.trim(), { title: "Gemini" });
      assistantMessageBuffer = "";
    }

    if (event.status === "success" && event.stats) {
      const stats = event.stats;
      const rows: Array<Array<{ data: string; header?: boolean } | string>> = [
        [
          { data: "Input Tokens", header: true },
          { data: "Output Tokens", header: true },
          { data: "Total Tokens", header: true },
          { data: "Tool Calls", header: true },
          { data: "Duration (ms)", header: true },
        ],
        [
          String(stats.input_tokens || 0),
          String(stats.output_tokens || 0),
          String(stats.total_tokens || 0),
          String(stats.tool_calls || 0),
          String(stats.duration_ms || 0),
        ],
      ];
      await log.summaryTable(rows);
    } else if (event.status === "error") {
      log.error(`Gemini CLI failed: ${JSON.stringify(event)}`);
    }
  },
};

export const gemini = agent({
  name: "gemini",
  install: async (githubInstallationToken?: string) => {
    return await installFromGithub({
      owner: "google-gemini",
      repo: "gemini-cli",
      assetName: "gemini.js",
      ...(githubInstallationToken && { githubInstallationToken }),
    });
  },
  run: async ({ payload, apiKey, mcpServers, githubInstallationToken, cliPath }) => {
    configureGeminiMcpServers({ mcpServers, cliPath });
    if (!apiKey) {
      throw new Error("google_api_key or gemini_api_key is required for gemini agent");
    }

    // Set environment variables for Gemini CLI and MCP servers
    process.env.GEMINI_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    const sessionPrompt = addInstructions(payload);
    log.info(`Starting Gemini CLI with prompt: ${payload.prompt.substring(0, 100)}...`);

    let finalOutput = "";
    try {
      const result = await spawn({
        cmd: "node",
        args: [cliPath, "--yolo", "--output-format=stream-json", "-p", sessionPrompt],
        env: {
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
          TMPDIR: process.env.TMPDIR || "/tmp",
          GEMINI_API_KEY: apiKey,
          GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
          LOG_LEVEL: process.env.LOG_LEVEL!,
          NODE_ENV: process.env.NODE_ENV!,
        },
        timeout: 600000, // 10 minutes
        onStdout: async (chunk) => {
          const text = chunk.toString();
          finalOutput += text;

          // parse each line as JSON (gemini cli outputs one JSON object per line)
          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            log.debug(`[gemini stdout] ${trimmed}`);

            try {
              const event = JSON.parse(trimmed) as GeminiEvent;
              const handler = messageHandlers[event.type as keyof typeof messageHandlers];
              if (handler) {
                await handler(event as never);
              }
            } catch {
              console.log("parse error", trimmed);
              // ignore parse errors - might be non-JSON output from gemini cli
            }
          }
        },
        onStderr: (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            log.debug(`[gemini stderr] ${trimmed}`);
            log.warning(trimmed);
            finalOutput += trimmed + "\n";
          }
        },
      });

      if (result.exitCode !== 0) {
        const errorMessage =
          result.stderr ||
          finalOutput ||
          result.stdout ||
          "Unknown error - no output from Gemini CLI";
        log.error(`Gemini CLI exited with code ${result.exitCode}: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          output: finalOutput || result.stdout || "",
        };
      }

      finalOutput = finalOutput || result.stdout || "Gemini CLI completed successfully.";
      log.info("✓ Gemini CLI completed successfully");

      return {
        success: true,
        output: finalOutput,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to run Gemini CLI: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: finalOutput || "",
      };
    }
  },
});

/**
 * Configure MCP servers for Gemini using the CLI.
 * Gemini CLI syntax: gemini mcp add <name> <commandOrUrl> [args...] --transport <type>
 * For HTTP-based servers, use: gemini mcp add <name> <url> --transport http
 */
function configureGeminiMcpServers({ mcpServers, cliPath }: ConfigureMcpServersParams): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type === "http") {
      // HTTP-based MCP server - use URL with --transport http flag
      const addArgs = ["mcp", "add", serverName, serverConfig.url, "--transport", "http"];

      log.info(`Adding MCP server '${serverName}' at ${serverConfig.url}...`);
      const addResult = spawnSync("node", [cliPath, ...addArgs], {
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (addResult.status !== 0) {
        throw new Error(
          `gemini mcp add failed: ${addResult.stderr || addResult.stdout || "Unknown error"}`
        );
      }
      log.info(`✓ MCP server '${serverName}' configured`);
    } else {
      throw new Error(
        `Unsupported MCP server type for Gemini: ${(serverConfig as any).type || "unknown"}`
      );
    }
  }
}
