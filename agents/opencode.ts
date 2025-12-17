import { mkdirSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import {
  agent,
  type ConfigureMcpServersParams,
  installFromNpmTarball,
  setupProcessAgentEnv,
} from "./shared.ts";

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
  run: async ({ payload, apiKey: _apiKey, apiKeys, mcpServers, cliPath, prepResults, repo }) => {
    // 1. configure home/config directory
    const tempHome = process.env.PULLFROG_TEMP_DIR!;
    const configDir = join(tempHome, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });

    configureOpenCode({ mcpServers, sandbox: payload.sandbox ?? false });

    const prompt = addInstructions({ payload, prepResults, repo });
    log.group("Full prompt", () => log.info(prompt));

    // message positional must come right after "run", before flags
    const args = ["run", prompt, "--format", "json"];

    if (payload.sandbox) {
      log.info("🔒 sandbox mode enabled: restricting to read-only operations");
    }

    // 6. set up environment
    setupProcessAgentEnv({ HOME: tempHome });

    // build env vars: start with process.env (includes all API_KEY vars loaded by config())
    // exclude GITHUB_TOKEN - OpenCode should use MCP server for GitHub operations, not direct token
    // then override with apiKeys, HOME, and XDG_CONFIG_HOME
    // XDG_CONFIG_HOME must be set because GitHub Actions sets it to a different path,
    // and OpenCode follows XDG spec (checks XDG_CONFIG_HOME before falling back to $HOME/.config)
    const env: Record<string, string> = {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) => value !== undefined && key !== "GITHUB_TOKEN"
        )
      ) as Record<string, string>),
      HOME: tempHome,
      XDG_CONFIG_HOME: join(tempHome, ".config"),
    };

    // add/override API keys from apiKeys object (uppercase keys)
    for (const [key, value] of Object.entries(apiKeys || {})) {
      env[key.toUpperCase()] = value;
    }

    // run OpenCode in the repository directory (process.cwd() is set to GITHUB_WORKSPACE or repo dir)
    const repoDir = process.cwd();

    log.info(`🚀 Starting OpenCode CLI: ${cliPath} ${args.join(" ")}`);
    log.info(`📁 Working directory: ${repoDir}`);
    log.debug(`🏠 HOME: ${env.HOME}`);
    log.debug(`📋 XDG_CONFIG_HOME: ${env.XDG_CONFIG_HOME}`);

    const startTime = Date.now();
    let lastActivityTime = startTime;
    let eventCount = 0;
    let stdoutBuffer = "";

    let output = "";
    const result = await spawn({
      cmd: cliPath,
      args,
      cwd: repoDir,
      env,
      timeout: 600000, // 10 minutes timeout to prevent infinite hangs
      stdio: ["ignore", "pipe", "pipe"],
      onStdout: async (chunk) => {
        const text = chunk.toString();
        output += text;
        stdoutBuffer += text;

        // parse each complete line as JSON (opencode outputs one JSON object per line)
        const lines = stdoutBuffer.split("\n");
        // keep the last (potentially incomplete) line in the buffer
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const event = JSON.parse(trimmed) as OpenCodeEvent;
            log.debug(JSON.stringify(event, null, 2));
            eventCount++;
            const timeSinceLastActivity = Date.now() - lastActivityTime;
            if (timeSinceLastActivity > 10000) {
              const activeToolCalls = toolCallTimings.size;
              const toolCallInfo =
                activeToolCalls > 0
                  ? ` (waiting for ${activeToolCalls} tool call${activeToolCalls > 1 ? "s" : ""})`
                  : " (OpenCode may be processing internally - LLM calls, planning, etc.)";
              log.warning(
                `⚠️  No activity for ${(timeSinceLastActivity / 1000).toFixed(1)}s${toolCallInfo} (${eventCount} events processed so far)`
              );
            }
            lastActivityTime = Date.now();
            const handler = messageHandlers[event.type as keyof typeof messageHandlers];
            if (handler) {
              await handler(event as never);
            } else {
              // log unhandled event types for visibility
              log.info(
                `📋 OpenCode event (unhandled): type=${event.type}, data=${JSON.stringify(event).substring(0, 500)}`
              );
            }
          } catch {
            // non-JSON lines are ignored
          }
        }
      },
      onStderr: (chunk) => {
        try {
          const parsed = JSON.parse(chunk);
          log.debug(JSON.stringify(parsed, null, 2));
        } catch {
          // if not JSON, fall through to regular error logging
        }
        const trimmed = chunk.trim();
        if (trimmed) {
          log.warning(trimmed);
        }
      },
    });

    const duration = Date.now() - startTime;
    log.info(`✅ OpenCode CLI completed in ${duration}ms with exit code ${result.exitCode}`);

    // 8. log tokens if they weren't logged yet (fallback if result event wasn't emitted)
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

    // 9. return result
    if (result.exitCode !== 0) {
      const errorMessage =
        result.stderr || result.stdout || "Unknown error - no output from OpenCode CLI";
      log.error(`OpenCode CLI exited with code ${result.exitCode}: ${errorMessage}`);
      log.debug(`OpenCode stdout: ${result.stdout?.substring(0, 500)}`);
      log.debug(`OpenCode stderr: ${result.stderr?.substring(0, 500)}`);
      return {
        success: false,
        output: finalOutput || output,
        error: errorMessage,
      };
    }

    return {
      success: true,
      output: finalOutput || output,
    };
  },
});

interface ConfigureOpenCodeParams {
  mcpServers: ConfigureMcpServersParams["mcpServers"];
  sandbox: boolean;
}

/**
 * Configure OpenCode via opencode.json config file.
 * Builds complete config with MCP servers and permissions in a single write to avoid race conditions.
 */
function configureOpenCode({ mcpServers, sandbox }: ConfigureOpenCodeParams): void {
  const tempHome = process.env.PULLFROG_TEMP_DIR!;
  const configDir = join(tempHome, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "opencode.json");

  // build MCP servers config
  const opencodeMcpServers: Record<string, { type: "remote"; url: string }> = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type !== "http") {
      log.error(
        `unsupported MCP server type for OpenCode: ${(serverConfig as never as { type: string }).type || "unknown"}`
      );
      throw new Error(
        `Unsupported MCP server type for OpenCode: ${(serverConfig as never as { type: string }).type || "unknown"}`
      );
    }

    opencodeMcpServers[serverName] = {
      type: "remote",
      url: serverConfig.url,
    };
  }

  // build permissions config
  const permission = sandbox
    ? {
        edit: "deny",
        bash: "deny",
        webfetch: "deny",
        doom_loop: "allow",
        external_directory: "allow",
      }
    : {
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
        doom_loop: "allow",
        external_directory: "allow",
      };

  // build complete config in one object
  const config = {
    mcp: opencodeMcpServers,
    permission,
  };

  const configJson = JSON.stringify(config, null, 2);
  try {
    writeFileSync(configPath, configJson, "utf-8");
  } catch (error) {
    log.error(
      `failed to write OpenCode config to ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  log.info(`OpenCode config written to ${configPath} (sandbox: ${sandbox})`);
  log.debug(`OpenCode config contents:\n${configJson}`);
}

////////////////////////////////////////////
////////////   EVENT HANDLERS   ////////////
////////////////////////////////////////////

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
  timestamp?: number;
  sessionID?: string;
  part?: {
    id?: string;
    callID?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: unknown;
      output?: string;
    };
  };
  [key: string]: unknown;
}

interface OpenCodeToolResultEvent {
  type: "tool_result";
  timestamp?: number;
  sessionID?: string;
  part?: {
    callID?: string;
    state?: {
      status?: string;
      output?: string;
    };
  };
  // fallback fields for older format
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

interface OpenCodeErrorEvent {
  type: "error";
  timestamp?: string;
  sessionID?: string;
  error?: {
    name?: string;
    message?: string;
    data?: unknown;
    [key: string]: unknown;
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
  | OpenCodeResultEvent
  | OpenCodeErrorEvent;

let finalOutput = "";
let accumulatedTokens: { input: number; output: number } = { input: 0, output: 0 };
let tokensLogged = false;
const toolCallTimings = new Map<string, number>();
let currentStepId: string | null = null;
let currentStepType: string | null = null;
let stepHistory: Array<{ stepId: string; stepType: string; toolCalls: string[] }> = [];

const messageHandlers = {
  init: (event: OpenCodeInitEvent) => {
    // initialization event - reset state
    log.info(
      `🔵 OpenCode init: session_id=${event.session_id || "unknown"}, model=${event.model || "unknown"}`
    );
    log.info(`🔵 OpenCode init event (full): ${JSON.stringify(event)}`);
    finalOutput = "";
    accumulatedTokens = { input: 0, output: 0 };
    tokensLogged = false;
  },
  message: (event: OpenCodeMessageEvent) => {
    if (event.role === "assistant" && event.content?.trim()) {
      const message = event.content.trim();
      if (message) {
        if (event.delta) {
          // delta messages are streaming thoughts/reasoning
          log.info(
            `💭 OpenCode thinking: ${message.substring(0, 300)}${message.length > 300 ? "..." : ""}`
          );
        } else {
          // complete messages
          log.info(
            `💬 OpenCode message (${event.role}): ${message.substring(0, 100)}${message.length > 100 ? "..." : ""}`
          );
          finalOutput = message;
        }
      }
    } else if (event.role === "user") {
      log.info(
        `💬 OpenCode message (${event.role}): ${event.content?.substring(0, 100) || ""}${event.content && event.content.length > 100 ? "..." : ""}`
      );
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
  step_start: (event: OpenCodeStepStartEvent) => {
    const stepType = event.part?.type || "unknown";
    const stepId = event.part?.id || "unknown";
    currentStepId = stepId;
    currentStepType = stepType;
    stepHistory.push({ stepId, stepType, toolCalls: [] });
  },
  step_finish: async (event: OpenCodeStepFinishEvent) => {
    const stepId = event.part?.id || "unknown";

    // accumulate tokens from step_finish events (they come here, not in result)
    const eventTokens = event.part?.tokens;
    if (eventTokens) {
      const inputTokens = eventTokens.input || 0;
      const outputTokens = eventTokens.output || 0;

      // accumulate tokens (don't log yet - wait for result event)
      accumulatedTokens.input += inputTokens;
      accumulatedTokens.output += outputTokens;
    }

    // clear current step
    if (currentStepId === stepId) {
      currentStepId = null;
      currentStepType = null;
    }
  },
  tool_use: (event: OpenCodeToolUseEvent) => {
    const toolName = event.part?.tool;
    const toolId = event.part?.callID;
    const parameters = event.part?.state?.input;
    const status = event.part?.state?.status;
    const output = event.part?.state?.output;

    if (toolName && toolId) {
      // track tool call in current step
      if (stepHistory.length > 0) {
        stepHistory[stepHistory.length - 1].toolCalls.push(toolName);
      }

      log.toolCall({
        toolName,
        input: parameters || {},
      });

      // if tool already completed (status in same event), log output
      if (status === "completed" && output) {
        log.debug(`  output: ${output}`);
      }
    }
  },
  tool_result: (event: OpenCodeToolResultEvent) => {
    // handle both new part structure and legacy flat structure
    const toolId = event.part?.callID || event.tool_id;
    const status = event.part?.state?.status || event.status || "unknown";
    const output = event.part?.state?.output || event.output;

    if (toolId) {
      const toolStartTime = toolCallTimings.get(toolId);
      if (toolStartTime) {
        const toolDuration = Date.now() - toolStartTime;
        toolCallTimings.delete(toolId);
        const stepContext = currentStepId ? ` (step=${currentStepType || "unknown"})` : "";
        log.info(
          `🔧 OpenCode tool_result${stepContext}: id=${toolId}, status=${status}, duration=${toolDuration}ms`
        );
        if (output) {
          log.debug(`  output: ${typeof output === "string" ? output : JSON.stringify(output)}`);
        }
        if (toolDuration > 5000) {
          log.warning(
            `⚠️  Tool call took ${(toolDuration / 1000).toFixed(1)}s - this may indicate network latency or slow processing`
          );
        }
      }
    }
    if (status === "error") {
      const errorMsg = typeof output === "string" ? output : JSON.stringify(output);
      log.warning(`❌ Tool call failed: ${errorMsg}`);
    }
  },
  result: async (event: OpenCodeResultEvent) => {
    const status = event.status || "unknown";
    const duration = event.stats?.duration_ms || 0;
    const toolCalls = event.stats?.tool_calls || 0;
    log.info(
      `🏁 OpenCode result: status=${status}, duration=${duration}ms, tool_calls=${toolCalls}`
    );

    if (event.status === "error") {
      log.error(`❌ OpenCode CLI failed: ${JSON.stringify(event)}`);
    } else {
      // log tokens once at the end (use stats from result if available, otherwise use accumulated from step_finish)
      const inputTokens = event.stats?.input_tokens || accumulatedTokens.input || 0;
      const outputTokens = event.stats?.output_tokens || accumulatedTokens.output || 0;
      const totalTokens = event.stats?.total_tokens || inputTokens + outputTokens;
      log.info(
        `📊 OpenCode final stats: input=${inputTokens}, output=${outputTokens}, total=${totalTokens}, tool_calls=${toolCalls}, duration=${duration}ms`
      );

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
