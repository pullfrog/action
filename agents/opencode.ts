import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import {
  agent,
  type ConfigureMcpServersParams,
  createAgentEnv,
  installFromNpmTarball,
  setupProcessAgentEnv,
} from "./shared.ts";

// opencode cli event types inferred from json output format
interface OpenCodeInitEvent {
  type: "init";
  timestamp?: string;
  session_id?: string;
  model?: string;
  [key: string]: unknown;
}

interface OpenCodeMessageEvent {
  type: "message";
  timestamp?: string;
  role?: "user" | "assistant";
  content?: string;
  delta?: boolean;
  [key: string]: unknown;
}

interface OpenCodeTextEvent {
  type: "text";
  timestamp?: string;
  sessionID?: string;
  part?: {
    id?: string;
    type?: string;
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OpenCodeStepStartEvent {
  type: "step_start";
  timestamp?: string;
  sessionID?: string;
  part?: {
    id?: string;
    type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OpenCodeStepFinishEvent {
  type: "step_finish";
  timestamp?: string;
  sessionID?: string;
  part?: {
    id?: string;
    type?: string;
    reason?: string;
    cost?: number;
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: {
        read?: number;
        write?: number;
      };
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OpenCodeToolUseEvent {
  type: "tool_use";
  timestamp?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

interface OpenCodeToolResultEvent {
  type: "tool_result";
  timestamp?: string;
  tool_id?: string;
  status?: "success" | "error";
  output?: string;
  [key: string]: unknown;
}

interface OpenCodeResultEvent {
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

type OpenCodeEvent =
  | OpenCodeInitEvent
  | OpenCodeMessageEvent
  | OpenCodeTextEvent
  | OpenCodeStepStartEvent
  | OpenCodeStepFinishEvent
  | OpenCodeToolUseEvent
  | OpenCodeToolResultEvent
  | OpenCodeResultEvent;

let finalOutput = "";
let accumulatedTokens: { input: number; output: number } = { input: 0, output: 0 };
let tokensLogged = false;

const messageHandlers = {
  init: (_event: OpenCodeInitEvent) => {
    // initialization event - reset state
    finalOutput = "";
    accumulatedTokens = { input: 0, output: 0 };
    tokensLogged = false;
  },
  message: (event: OpenCodeMessageEvent) => {
    // update finalOutput but don't log here - text handler will log
    if (event.role === "assistant" && event.content?.trim() && !event.delta) {
      const message = event.content.trim();
      if (message) {
        finalOutput = message;
      }
    }
  },
  text: (event: OpenCodeTextEvent) => {
    // log from text events only to avoid duplicates
    if (event.part?.text?.trim()) {
      const message = event.part.text.trim();
      log.box(message, { title: "OpenCode" });
      finalOutput = message;
    }
  },
  step_start: (_event: OpenCodeStepStartEvent) => {
    // step start - no logging needed
  },
  step_finish: async (event: OpenCodeStepFinishEvent) => {
    // accumulate tokens from step_finish events (they come here, not in result)
    const eventTokens = event.part?.tokens;
    if (eventTokens) {
      const inputTokens = eventTokens.input || 0;
      const outputTokens = eventTokens.output || 0;

      // accumulate tokens (don't log yet - wait for result event)
      accumulatedTokens.input += inputTokens;
      accumulatedTokens.output += outputTokens;
    }
  },
  tool_use: (event: OpenCodeToolUseEvent) => {
    if (event.tool_name) {
      log.toolCall({
        toolName: event.tool_name,
        input: event.parameters || {},
      });
    }
  },
  tool_result: (event: OpenCodeToolResultEvent) => {
    if (event.status === "error") {
      const errorMsg =
        typeof event.output === "string" ? event.output : JSON.stringify(event.output);
      log.warning(`Tool call failed: ${errorMsg}`);
    }
  },
  result: async (event: OpenCodeResultEvent) => {
    if (event.status === "error") {
      log.error(`OpenCode CLI failed: ${JSON.stringify(event)}`);
    } else {
      // log tokens once at the end (use stats from result if available, otherwise use accumulated from step_finish)
      const inputTokens = event.stats?.input_tokens || accumulatedTokens.input || 0;
      const outputTokens = event.stats?.output_tokens || accumulatedTokens.output || 0;
      const totalTokens = event.stats?.total_tokens || inputTokens + outputTokens;

      if ((inputTokens > 0 || outputTokens > 0) && !tokensLogged) {
        await log.summaryTable([
          [
            { data: "Input Tokens", header: true },
            { data: "Output Tokens", header: true },
            { data: "Total Tokens", header: true },
          ],
          [String(inputTokens), String(outputTokens), String(totalTokens)],
        ]);
        tokensLogged = true;
      }
    }
  },
};

export const opencode = agent({
  name: "opencode",
  install: async () => {
    return await installFromNpmTarball({
      packageName: "opencode-ai",
      version: "latest",
      executablePath: "bin/opencode",
      installDependencies: true,
    });
  },
  run: async ({ payload, apiKey, mcpServers, cliPath }) => {
    // 1. configure home/config directory
    const tempHome = process.env.PULLFROG_TEMP_DIR!;
    const configDir = join(tempHome, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });

    // 2. initialize MCP servers and sandbox
    configureOpenCodeMcpServers({ mcpServers });
    configureOpenCodeSandbox({ sandbox: payload.sandbox ?? false });

    if (!apiKey) {
      throw new Error("anthropic_api_key is required for opencode agent");
    }

    // 3. prepare prompt and args
    const prompt = addInstructions(payload);
    const args = ["run", "--format", "json", "-m", "anthropic/claude-sonnet-4-20250514", prompt];

    if (payload.sandbox) {
      log.info("🔒 sandbox mode enabled: restricting to read-only operations");
    }

    // 4. set up environment
    const packageDir = join(cliPath, "..", "..");
    setupProcessAgentEnv({ ANTHROPIC_API_KEY: apiKey, HOME: tempHome });
    const env = createAgentEnv({ ANTHROPIC_API_KEY: apiKey, HOME: tempHome });

    // 5. spawn and stream JSON output
    let output = "";
    const result = await spawn({
      cmd: cliPath,
      args,
      cwd: packageDir,
      env,
      timeout: 300000,
      stdio: ["ignore", "pipe", "pipe"],
      onStdout: async (chunk) => {
        const text = chunk.toString();
        output += text;

        // parse each line as JSON (opencode outputs one JSON object per line)
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const event = JSON.parse(trimmed) as OpenCodeEvent;
            const handler = messageHandlers[event.type as keyof typeof messageHandlers];
            if (handler) {
              await handler(event as never);
            }
          } catch {
            // non-JSON lines are ignored
          }
        }
      },
      onStderr: (chunk) => {
        const trimmed = chunk.trim();
        if (trimmed) {
          log.warning(trimmed);
        }
      },
    });

    // 6. log tokens if they weren't logged yet (fallback if result event wasn't emitted)
    if (!tokensLogged && (accumulatedTokens.input > 0 || accumulatedTokens.output > 0)) {
      const totalTokens = accumulatedTokens.input + accumulatedTokens.output;
      await log.summaryTable([
        [
          { data: "Input Tokens", header: true },
          { data: "Output Tokens", header: true },
          { data: "Total Tokens", header: true },
        ],
        [String(accumulatedTokens.input), String(accumulatedTokens.output), String(totalTokens)],
      ]);
    }

    // 7. return result
    return {
      success: result.exitCode === 0,
      output: finalOutput || output,
      error: result.exitCode !== 0 ? result.stderr : undefined,
    };
  },
});

/**
 * Configure MCP servers for OpenCode using opencode.json config file.
 * OpenCode uses opencode.json with mcp section supporting remote servers with type: "remote" and url.
 */
function configureOpenCodeMcpServers({
  mcpServers,
}: {
  mcpServers: ConfigureMcpServersParams["mcpServers"];
}): void {
  const tempHome = process.env.PULLFROG_TEMP_DIR!;
  const configDir = join(tempHome, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "opencode.json");

  // convert to opencode's expected format
  const opencodeMcpServers: Record<string, { type: "remote"; url: string; enabled?: boolean }> = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type !== "http") {
      throw new Error(
        `Unsupported MCP server type for OpenCode: ${(serverConfig as any).type || "unknown"}`
      );
    }

    opencodeMcpServers[serverName] = {
      type: "remote",
      url: serverConfig.url,
      enabled: true,
    };
  }

  // read existing config if it exists, or create new one
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const existingConfig = readFileSync(configPath, "utf-8");
      config = JSON.parse(existingConfig);
    }
  } catch {
    // config doesn't exist yet or is invalid, start fresh
  }

  config.mcp = opencodeMcpServers;

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.info(`MCP config written to ${configPath}`);
}

/**
 * Configure OpenCode sandbox mode via opencode.json.
 * When sandbox is enabled, restricts tools to read-only operations.
 */
function configureOpenCodeSandbox({ sandbox }: { sandbox: boolean }): void {
  const tempHome = process.env.PULLFROG_TEMP_DIR!;
  const configDir = join(tempHome, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "opencode.json");

  // read existing config if it exists, or create new one
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const existingConfig = readFileSync(configPath, "utf-8");
      config = JSON.parse(existingConfig);
    }
  } catch {
    // config doesn't exist yet or is invalid, start fresh
  }

  if (sandbox) {
    // sandbox mode: disable write, bash, and webfetch tools
    config.tools = {
      write: false,
      bash: false,
      webfetch: false,
    };
  } else {
    // normal mode: enable all tools (or don't set tools config to use defaults)
    config.tools = {
      write: true,
      bash: true,
      webfetch: true,
    };
  }

  // preserve MCP config if it was already set by configureOpenCodeMcpServers
  // (this function is called after configureOpenCodeMcpServers, so MCP config should already exist)
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.info(`OpenCode config written to ${configPath} (sandbox: ${sandbox})`);
}
