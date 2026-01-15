import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort } from "../external.ts";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import {
  agent,
  type ConfigureMcpServersParams,
  createAgentEnv,
  installFromGithub,
} from "./shared.ts";

// effort configuration: model + thinking level
// thinkingLevel is set via settings.json modelConfig.generateContentConfig.thinkingConfig
// see: https://ai.google.dev/gemini-api/docs/thinking#thinking-levels
// latest models:
const geminiEffortConfig: Record<Effort, { model: string; thinkingLevel: string }> = {
  // https://ai.google.dev/gemini-api/docs/models
  // the docs mention needing to enable preview features for these models but if you
  // pass the model directly it works if we ever did need to do something like this,
  // we could write to .gemini/settings.json
  mini: { model: "gemini-3-flash-preview", thinkingLevel: "LOW" },
  auto: { model: "gemini-3-flash-preview", thinkingLevel: "HIGH" },
  max: { model: "gemini-3-pro-preview", thinkingLevel: "HIGH" },
} as const;

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
    log.debug(JSON.stringify(_event, null, 2));
    // initialization event - no logging needed
    assistantMessageBuffer = "";
  },
  message: (event: GeminiMessageEvent) => {
    log.debug(JSON.stringify(event, null, 2));
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
    log.debug(JSON.stringify(event, null, 2));
    if (event.tool_name) {
      log.toolCall({
        toolName: event.tool_name,
        input: event.parameters || {},
      });
    }
  },
  tool_result: (event: GeminiToolResultEvent) => {
    log.debug(JSON.stringify(event, null, 2));
    if (event.status === "error") {
      const errorMsg =
        typeof event.output === "string" ? event.output : JSON.stringify(event.output);
      log.warning(`Tool call failed: ${errorMsg}`);
    }
  },
  result: async (event: GeminiResultEvent) => {
    log.debug(JSON.stringify(event, null, 2));
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
      log.table(rows);
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
  run: async ({ payload, apiKey, mcpServers, cliPath, repo, effort }) => {
    // get model and thinking level based on effort
    const { model, thinkingLevel } = geminiEffortConfig[effort];
    log.info(`Using model: ${model}, thinkingLevel: ${thinkingLevel}`);

    configureGeminiSettings({ mcpServers, isPublicRepo: repo.isPublic, thinkingLevel });

    if (!apiKey) {
      throw new Error("google_api_key or gemini_api_key is required for gemini agent");
    }

    const sessionPrompt = addInstructions({ payload, repo });
    log.group("Full prompt", () => log.info(sessionPrompt));

    // build CLI args based on sandbox mode
    // for public repos, native shell is disabled via excludeTools in settings.json
    let args: string[];
    if (payload.sandbox) {
      // sandbox mode: read-only tools only
      args = [
        "--model",
        model,
        "--allowed-tools",
        "read_file,list_directory,search_file_content,glob,save_memory,write_todos",
        "--allowed-mcp-server-names",
        "gh_pullfrog",
        "--output-format=stream-json",
        "-p",
        sessionPrompt,
      ];
    } else {
      // normal mode: --yolo for auto-approval
      // for public repos, shell is excluded via settings.json excludeTools
      args = ["--model", model, "--yolo", "--output-format=stream-json", "-p", sessionPrompt];
      if (repo.isPublic) {
        log.info("🔒 public repo: native shell disabled via excludeTools, using MCP bash");
      }
    }

    if (payload.sandbox) {
      log.info("🔒 sandbox mode enabled: restricting to read-only operations");
    }

    let finalOutput = "";
    let stdoutBuffer = "";

    try {
      const result = await spawn({
        cmd: "node",
        args: [cliPath, ...args],
        env: createAgentEnv({ GEMINI_API_KEY: apiKey }),
        onStdout: async (chunk) => {
          const text = chunk.toString();
          finalOutput += text;

          // buffer incomplete lines across chunks (NDJSON format)
          stdoutBuffer += text;
          const lines = stdoutBuffer.split("\n");

          // keep the last element (may be incomplete) in the buffer
          stdoutBuffer = lines.pop() || "";

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
              // ignore parse errors - might be non-JSON output from gemini cli
              log.debug(`[gemini] non-JSON stdout line: ${trimmed.substring(0, 200)}`);
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

type ConfigureGeminiParams = {
  mcpServers: ConfigureMcpServersParams["mcpServers"];
  isPublicRepo: boolean;
  thinkingLevel: string;
};

/**
 * Configure Gemini CLI settings by writing to settings.json.
 * - MCP servers: uses `httpUrl` for HTTP/streamable transport
 * - thinkingLevel: configured via modelConfig.generateContentConfig.thinkingConfig
 * - For public repos, excludeTools disables native shell
 *
 * See: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md
 */
function configureGeminiSettings({
  mcpServers,
  isPublicRepo,
  thinkingLevel,
}: ConfigureGeminiParams): void {
  const realHome = homedir();
  const geminiConfigDir = join(realHome, ".gemini");
  const settingsPath = join(geminiConfigDir, "settings.json");
  mkdirSync(geminiConfigDir, { recursive: true });

  // read existing settings if present
  let existingSettings: Record<string, unknown> = {};
  try {
    const content = readFileSync(settingsPath, "utf-8");
    existingSettings = JSON.parse(content);
  } catch {
    // file doesn't exist or is invalid - start fresh
  }

  // convert to Gemini's expected format (httpUrl for HTTP transport, no type field)
  type GeminiMcpServerConfig = {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    httpUrl?: string;
    headers?: Record<string, string>;
    timeout?: number;
    trust?: boolean;
    description?: string;
    includeTools?: string[];
    excludeTools?: string[];
  };
  const geminiMcpServers: Record<string, GeminiMcpServerConfig> = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type !== "http") {
      throw new Error(
        `Unsupported MCP server type for Gemini: ${(serverConfig as { type?: string }).type || "unknown"}`
      );
    }
    geminiMcpServers[serverName] = {
      httpUrl: serverConfig.url,
      trust: true, // trust our own MCP server to avoid confirmation prompts
    };
    log.info(`Adding MCP server '${serverName}' at ${serverConfig.url}...`);
  }

  // merge with existing settings, overwriting mcpServers and modelConfig
  const newSettings: Record<string, unknown> = {
    ...existingSettings,
    mcpServers: geminiMcpServers,
    // configure thinking level via modelConfig
    // see: https://ai.google.dev/api/generate-content (ThinkingConfig)
    modelConfig: {
      generateContentConfig: {
        thinkingConfig: {
          thinkingLevel,
        },
      },
    },
  };

  // for public repos, exclude native shell tool to prevent secret leakage via env
  if (isPublicRepo) {
    newSettings.excludeTools = ["run_shell_command"];
  }

  writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), "utf-8");
  log.info(`» Gemini settings written to ${settingsPath}`);
}
