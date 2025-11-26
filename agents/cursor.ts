import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromCurl } from "./shared.ts";

// cursor cli event types inferred from stream-json output
interface CursorSystemEvent {
  type: "system";
  subtype?: string;
  [key: string]: unknown;
}

interface CursorUserEvent {
  type: "user";
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  [key: string]: unknown;
}

interface CursorThinkingEvent {
  type: "thinking";
  subtype: "delta" | "completed";
  text?: string;
  [key: string]: unknown;
}

interface CursorAssistantEvent {
  type: "assistant";
  model_call_id?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  [key: string]: unknown;
}

interface CursorToolCallEvent {
  type: "tool_call";
  subtype: "started" | "completed";
  call_id?: string;
  tool_call?: {
    mcpToolCall?: {
      args?: {
        name?: string;
        args?: unknown;
        toolName?: string;
        providerIdentifier?: string;
      };
      result?: {
        success?: {
          content?: Array<{ text?: { text?: string } }>;
          isError?: boolean;
        };
      };
    };
  };
  [key: string]: unknown;
}

interface CursorResultEvent {
  type: "result";
  subtype: "success" | "error";
  result?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

type CursorEvent =
  | CursorSystemEvent
  | CursorUserEvent
  | CursorThinkingEvent
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent;

const messageHandlers = {
  system: (_event: CursorSystemEvent) => {
    // system init events - no logging needed
  },
  user: (_event: CursorUserEvent) => {
    // user messages already logged in prompt box
  },
  thinking: (_event: CursorThinkingEvent) => {
    // thinking events are internal - no logging needed
  },
  assistant: (event: CursorAssistantEvent) => {
    // only log finalized messages (ones with model_call_id)
    // cursor emits each message twice: once without model_call_id, then again with it
    if (event.model_call_id) {
      const text = event.message?.content?.[0]?.text;
      if (text?.trim()) {
        log.box(text.trim(), { title: "Cursor" });
      }
    }
  },
  tool_call: (event: CursorToolCallEvent) => {
    if (event.subtype === "started") {
      // handle both MCP tools and built-in tools (bash, WebFetch, etc)
      const mcpToolCall = event.tool_call?.mcpToolCall;
      const builtinToolCall = (event.tool_call as any)?.builtinToolCall;

      if (mcpToolCall?.args?.toolName && mcpToolCall?.args?.args) {
        log.toolCall({
          toolName: mcpToolCall.args.toolName,
          input: mcpToolCall.args.args,
        });
      } else if (builtinToolCall?.args?.name && builtinToolCall?.args?.args) {
        log.toolCall({
          toolName: builtinToolCall.args.name,
          input: builtinToolCall.args.args,
        });
      }
    } else if (event.subtype === "completed") {
      const isError = event.tool_call?.mcpToolCall?.result?.success?.isError;
      if (isError) {
        log.warning("Tool call failed");
      }
    }
  },
  result: async (event: CursorResultEvent) => {
    if (event.subtype === "success" && event.duration_ms) {
      const durationSec = (event.duration_ms / 1000).toFixed(1);
      log.debug(`Cursor completed in ${durationSec}s`);
    }
  },
};

export const cursor = agent({
  name: "cursor",
  install: async () => {
    return await installFromCurl({
      installUrl: "https://cursor.com/install",
      executableName: "cursor-agent",
    });
  },
  run: async ({ payload, apiKey, cliPath, githubInstallationToken, mcpServers }) => {
    process.env.CURSOR_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    configureCursorMcpServers({ mcpServers, cliPath });

    try {
      const fullPrompt = addInstructions(payload);

      log.info("Running Cursor CLI...");

      const startTime = Date.now();

      return new Promise((resolve) => {
        const child = spawn(
          cliPath,
          [
            "--print",
            fullPrompt,
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--approve-mcps",
            "--force",
          ],
          {
            cwd: process.cwd(),
            env: {
              CURSOR_API_KEY: apiKey,
              GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
              LOG_LEVEL: process.env.LOG_LEVEL,
              NODE_ENV: process.env.NODE_ENV,
              HOME: process.env.HOME,
              PATH: process.env.PATH,
              // Don't override HOME - Cursor CLI needs access to macOS keychain
              // MCP config is written to tempDir/.cursor/mcp.json which Cursor will find
            },
            stdio: ["ignore", "pipe", "pipe"], // Ignore stdin, pipe stdout/stderr
          }
        );

        let stdout = "";
        let stderr = "";

        child.on("spawn", () => {
          log.debug("Cursor CLI process spawned");
        });

        child.stdout?.on("data", async (data) => {
          const text = data.toString();
          stdout += text;

          try {
            const event = JSON.parse(text) as CursorEvent;

            // route to appropriate handler
            const handler = messageHandlers[event.type as keyof typeof messageHandlers];
            if (handler) {
              await handler(event as never);
            }

            // debug: log all events
            log.debug(`[cursor event] ${JSON.stringify(event, null, 2)}`);
          } catch {
            // ignore parse errors - might be formatted tool call logs from cursor cli
            // our handlers log tool calls instead, so we don't need to display these
          }
        });

        child.stderr?.on("data", (data) => {
          const text = data.toString();
          stderr += text;
          process.stderr.write(text);
          log.warning(text);
        });

        child.on("close", async (code, signal) => {
          if (signal) {
            log.warning(`Cursor CLI terminated by signal: ${signal}`);
          }

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);

          if (code === 0) {
            log.success(`Cursor CLI completed successfully in ${duration}s`);
            resolve({
              success: true,
              output: stdout.trim(),
            });
          } else {
            const errorMessage = stderr || `Cursor CLI exited with code ${code}`;
            log.error(`Cursor CLI failed after ${duration}s: ${errorMessage}`);
            resolve({
              success: false,
              error: errorMessage,
              output: stdout.trim(),
            });
          }
        });

        child.on("error", (error) => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const errorMessage = error.message || String(error);
          log.error(`Cursor CLI execution failed after ${duration}s: ${errorMessage}`);
          resolve({
            success: false,
            error: errorMessage,
            output: stdout.trim(),
          });
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Cursor execution failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: "",
      };
    }
  },
});

// There was an issue on macOS when you set HOME to a temp directory
// it was unable to find the macOS keychain and would fail
// temp solution is to stick with the actual $HOME
function configureCursorMcpServers({ mcpServers }: ConfigureMcpServersParams) {
  const realHome = homedir();
  const cursorConfigDir = join(realHome, ".cursor");
  const mcpConfigPath = join(cursorConfigDir, "mcp.json");
  mkdirSync(cursorConfigDir, { recursive: true });

  // Convert to Cursor's expected format (HTTP config)
  const cursorMcpServers: Record<string, { type: string; url: string }> = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type !== "http") {
      throw new Error(
        `Unsupported MCP server type for Cursor: ${(serverConfig as any).type || "unknown"}`
      );
    }

    cursorMcpServers[serverName] = {
      type: "http",
      url: serverConfig.url,
    };
  }

  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: cursorMcpServers }, null, 2), "utf-8");
  log.info(`MCP config written to ${mcpConfigPath}`);
}
