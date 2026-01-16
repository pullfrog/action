import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort } from "../external.ts";
import { ghPullfrogMcpName } from "../external.ts";
import { log } from "../utils/cli.ts";
import { installFromCurl } from "../utils/install.ts";
import { type AgentRunContext, agent } from "./shared.ts";

// effort configuration for Cursor
// only "max" overrides the model; mini/auto use default ("auto")
const cursorEffortModels: Record<Effort, string | null> = {
  mini: null, // use default (auto)
  auto: null, // use default (auto)
  max: "opus-4.5-thinking",
} as const;

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

async function installCursor(): Promise<string> {
  return await installFromCurl({
    installUrl: "https://cursor.com/install",
    executableName: "cursor-agent",
  });
}

export const cursor = agent({
  name: "cursor",
  install: installCursor,
  run: async (ctx) => {
    // install CLI at start of run
    const cliPath = await installCursor();

    configureCursorMcpServers(ctx);
    configureCursorTools(ctx);

    // determine model based on effort level
    // respect project's .cursor/cli.json if it specifies a model
    const projectCliConfigPath = join(process.cwd(), ".cursor", "cli.json");
    let modelOverride: string | null = null;

    if (existsSync(projectCliConfigPath)) {
      try {
        const projectConfig = JSON.parse(readFileSync(projectCliConfigPath, "utf-8"));
        if (projectConfig.model) {
          log.info(`» using model from project .cursor/cli.json: ${projectConfig.model}`);
        } else {
          modelOverride = cursorEffortModels[ctx.payload.effort];
        }
      } catch {
        modelOverride = cursorEffortModels[ctx.payload.effort];
      }
    } else {
      modelOverride = cursorEffortModels[ctx.payload.effort];
    }

    if (modelOverride) {
      log.info(`» using model: ${modelOverride}, effort=${ctx.payload.effort}`);
    } else if (!existsSync(projectCliConfigPath)) {
      log.info(`» using default model, effort=${ctx.payload.effort}`);
    }

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
      // build CLI args
      const baseArgs = [
        "--print",
        ctx.instructions.full,
        "--output-format",
        "stream-json",
        "--approve-mcps",
      ];

      // add model flag if we have an override
      if (modelOverride) {
        baseArgs.push("--model", modelOverride);
      }

      // always use --force since permissions are controlled via cli-config.json
      const cursorArgs = [...baseArgs, "--force"];

      log.info("» running Cursor CLI...");

      const startTime = Date.now();

      return new Promise((resolve) => {
        const child = spawn(cliPath, cursorArgs, {
          cwd: process.cwd(),
          env: process.env,
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
            log.debug(JSON.stringify(event, null, 2));

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
function configureCursorMcpServers(ctx: AgentRunContext): void {
  const realHome = homedir();
  const cursorConfigDir = join(realHome, ".cursor");
  const mcpConfigPath = join(cursorConfigDir, "mcp.json");
  mkdirSync(cursorConfigDir, { recursive: true });

  const mcpServers = {
    [ghPullfrogMcpName]: { type: "http", url: ctx.mcpServerUrl },
  };
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2), "utf-8");
  log.info(`» MCP config written to ${mcpConfigPath}`);
}

interface CursorCliConfig {
  permissions: {
    allow: string[];
    deny: string[];
  };
  sandbox?: {
    mode: "enabled" | "disabled";
    networkAccess?: "allowlist" | "full";
  };
}

/**
 * Configure Cursor CLI tool permissions via cli-config.json.
 *
 * Config path: $HOME/.config/cursor/ (not ~/.cursor/).
 */
function configureCursorTools(ctx: AgentRunContext): void {
  const realHome = homedir();
  const cursorConfigDir = join(realHome, ".config", "cursor");
  const cliConfigPath = join(cursorConfigDir, "cli-config.json");
  mkdirSync(cursorConfigDir, { recursive: true });

  // build deny list based on tool permissions
  const bash = ctx.payload.bash;
  const deny: string[] = [];
  if (ctx.payload.search === "disabled") deny.push("WebSearch");
  if (ctx.payload.write === "disabled") deny.push("Write(**)");
  // both "disabled" and "restricted" block native shell
  if (bash !== "enabled") deny.push("Shell(*)");

  const config: CursorCliConfig = {
    permissions: {
      allow: ctx.payload.write === "disabled" ? ["Read(**)"] : ["Read(**)", "Write(**)"],
      deny,
    },
  };

  // web: "disabled" requires sandbox with network blocking
  // sandbox.networkAccess: "allowlist" blocks network in shell subprocesses via seatbelt
  if (ctx.payload.web === "disabled") {
    config.sandbox = {
      mode: "enabled",
      networkAccess: "allowlist",
    };
  }

  writeFileSync(cliConfigPath, JSON.stringify(config, null, 2), "utf-8");
  log.info(`» CLI config written to ${cliConfigPath}`, JSON.stringify(config, null, 2));
}
