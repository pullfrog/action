import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

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

// import { createOpencode } from "@opencode-ai/sdk"

// const { client } = await createOpencode({
//   config: {
//     ''
//   }
// })

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
      log.info(
        `📝 OpenCode text output: ${message.substring(0, 200)}${message.length > 200 ? "..." : ""}`
      );
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
    if (event.tool_name && event.tool_id) {
      toolCallTimings.set(event.tool_id, Date.now());
      const paramsStr = event.parameters
        ? JSON.stringify(event.parameters).substring(0, 500)
        : "{}";
      const stepContext = currentStepId
        ? ` (step=${currentStepType || "unknown"}, stepId=${currentStepId.substring(0, 20)}...)`
        : "";
      log.info(`🔧 OpenCode tool_use: ${event.tool_name}${stepContext}, id=${event.tool_id}`);
      log.info(`   Parameters: ${paramsStr}${paramsStr.length >= 500 ? "..." : ""}`);

      // track tool call in current step
      if (stepHistory.length > 0) {
        stepHistory[stepHistory.length - 1].toolCalls.push(event.tool_name);
      }

      log.toolCall({
        toolName: event.tool_name,
        input: event.parameters || {},
      });
    }
  },
  tool_result: (event: OpenCodeToolResultEvent) => {
    if (event.tool_id) {
      const toolStartTime = toolCallTimings.get(event.tool_id);
      if (toolStartTime) {
        const toolDuration = Date.now() - toolStartTime;
        toolCallTimings.delete(event.tool_id);
        const status = event.status || "unknown";
        const stepContext = currentStepId ? ` (step=${currentStepType || "unknown"})` : "";
        const outputPreview =
          typeof event.output === "string"
            ? event.output.substring(0, 500)
            : JSON.stringify(event.output).substring(0, 500);
        log.info(
          `🔧 OpenCode tool_result${stepContext}: id=${event.tool_id}, status=${status}, duration=${toolDuration}ms`
        );
        if (outputPreview && outputPreview !== "{}" && outputPreview !== "null") {
          log.info(`   Output: ${outputPreview}${outputPreview.length >= 500 ? "..." : ""}`);
        }
        if (toolDuration > 5000) {
          log.warning(
            `⚠️  Tool call took ${(toolDuration / 1000).toFixed(1)}s - this may indicate network latency or slow processing`
          );
        }
      }
    }
    if (event.status === "error") {
      const errorMsg =
        typeof event.output === "string" ? event.output : JSON.stringify(event.output);
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

    configureOpenCodeMcpServers({ mcpServers });
    configureOpenCodeSandbox({ sandbox: payload.sandbox ?? false });

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
    // then override with apiKeys and HOME
    const env: Record<string, string> = {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) => value !== undefined && key !== "GITHUB_TOKEN"
        )
      ) as Record<string, string>),
      HOME: tempHome,
    };

    // add/override API keys from apiKeys object (uppercase keys)
    for (const [key, value] of Object.entries(apiKeys || {})) {
      env[key.toUpperCase()] = value;
    }

    // run OpenCode in the repository directory (process.cwd() is set to GITHUB_WORKSPACE or repo dir)
    const repoDir = process.cwd();

    log.info(`🚀 Starting OpenCode CLI: ${cliPath} ${args.join(" ")}`);
    log.info(`📁 Working directory: ${repoDir}`);
    const startTime = Date.now();
    let lastActivityTime = startTime;
    let eventCount = 0;

    let output = "";
    const result = await spawn({
      cmd: cliPath,
      args,
      cwd: repoDir,
      env,
      timeout: 600000, // 10 minutes timeout to prevent infinite hangs
      stdio: ["ignore", "pipe", "pipe"],
      onStdout: async (chunk) => {
        log.debug(`[opencode stdout] ${chunk}`);
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
              // log unhandled event types for visibility (but don't spam)
              if (
                event.type &&
                ![
                  "init",
                  "message",
                  "text",
                  "step_start",
                  "step_finish",
                  "tool_use",
                  "tool_result",
                  "result",
                  "error",
                ].includes(event.type)
              ) {
                log.debug(`📋 OpenCode event (unhandled): type=${event.type}`);
              }
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
 * See https://opencode.ai/docs/permissions/ for config format.
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
    // sandbox mode: deny write, bash, and webfetch tools
    config.permission = {
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
      doom_loop: "allow",
      external_directory: "allow",
    };
  } else {
    // normal mode: allow all tools without prompts
    // external_directory: "allow" is critical to avoid permission prompts for temp dirs
    config.permission = {
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
      doom_loop: "allow",
      external_directory: "allow",
    };
  }

  // preserve MCP config if it was already set by configureOpenCodeMcpServers
  // (this function is called after configureOpenCodeMcpServers, so MCP config should already exist)
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.info(`OpenCode config written to ${configPath} (sandbox: ${sandbox})`);
}
