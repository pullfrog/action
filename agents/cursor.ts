import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import {
  agent,
  type ConfigureMcpServersParams,
  createAgentEnv,
  installFromCurl,
} from "./shared.ts";

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

export const cursor = agent({
  name: "cursor",
  install: async () => {
    return await installFromCurl({
      installUrl: "https://cursor.com/install",
      executableName: "cursor-agent",
    });
  },
  run: async ({ payload, apiKey, cliPath, mcpServers }) => {
    configureCursorMcpServers({ mcpServers, cliPath });
    configureCursorSandbox({ sandbox: payload.sandbox ?? false });

    // track logged model_call_ids to avoid duplicates
    // cursor emits each assistant message twice: once without model_call_id, then again with it
    const loggedModelCallIds = new Set<string>();

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
        const text = event.message?.content?.[0]?.text?.trim();
        if (!text) return;

        if (event.model_call_id) {
          // complete message with model_call_id - log it if we haven't seen this id before
          // cursor emits each message twice: first without model_call_id, then with it
          // we deduplicate by model_call_id to avoid logging the same message twice
          if (!loggedModelCallIds.has(event.model_call_id)) {
            loggedModelCallIds.add(event.model_call_id);
            log.box(text, { title: "Cursor" });
          }
        } else {
          // message without model_call_id - log it immediately
          // this handles cases where:
          // 1. the final summary message might only be emitted without model_call_id
          // 2. messages that don't get re-emitted with model_call_id
          // without this, the final comprehensive summary wouldn't print (as we discovered)
          log.box(text, { title: "Cursor" });
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
          // note: we don't log event.result here because it contains the full conversation
          // concatenated together, which would duplicate all the individual assistant
          // messages we've already logged. the individual assistant events are sufficient.
        }
      },
    };

    try {
      const fullPrompt = addInstructions(payload);

      // configure sandbox mode if enabled
      // in sandbox mode: remove --force flag and rely on cli-config.json sandbox settings
      const cursorArgs = payload.sandbox
        ? [
            "--print",
            fullPrompt,
            "--output-format",
            "stream-json",
            "--approve-mcps",
            // --force removed in sandbox mode to enforce safety checks
          ]
        : ["--print", fullPrompt, "--output-format", "stream-json", "--approve-mcps", "--force"];

      if (payload.sandbox) {
        log.info("🔒 sandbox mode enabled: restricting to read-only operations");
      }

      log.info("Running Cursor CLI...");

      const startTime = Date.now();

      return new Promise((resolve) => {
        const child = spawn(cliPath, cursorArgs, {
          cwd: process.cwd(),
          env: createAgentEnv({
            CURSOR_API_KEY: apiKey,
          }),
          stdio: ["ignore", "pipe", "pipe"], // Ignore stdin, pipe stdout/stderr
        });

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

            // skip empty thinking deltas
            if (event.type === "thinking" && event.subtype === "delta" && !event.text) {
              return;
            }

            // route to appropriate handler
            const handler = messageHandlers[event.type as keyof typeof messageHandlers];
            if (handler) {
              await handler(event as never);
            }
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

/**
 * Configure Cursor CLI sandbox mode via cli-config.json.
 * When sandbox is enabled, denies all file writes and shell commands.
 * In print mode without --force, writes are blocked by default, but we add
 * explicit deny rules as defense in depth.
 *
 * See: https://cursor.com/docs/cli/reference/permissions
 */
function configureCursorSandbox({ sandbox }: { sandbox: boolean }): void {
  const realHome = homedir();
  const cursorConfigDir = join(realHome, ".cursor");
  const cliConfigPath = join(cursorConfigDir, "cli-config.json");
  mkdirSync(cursorConfigDir, { recursive: true });

  const config = sandbox
    ? {
        // sandbox mode: deny all writes and shell commands
        permissions: {
          allow: [
            "Read(**)", // allow reading all files
          ],
          deny: [
            "Write(**)", // deny all file writes
            "Shell(**)", // deny all shell commands
          ],
        },
      }
    : {
        // normal mode: allow everything
        permissions: {
          allow: ["Read(**)", "Write(**)", "Shell(**)"],
          deny: [],
        },
      };

  writeFileSync(cliConfigPath, JSON.stringify(config, null, 2), "utf-8");
  log.info(`CLI config written to ${cliConfigPath} (sandbox: ${sandbox})`);
}
