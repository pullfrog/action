import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Effort } from "../external.ts";
import { ghPullfrogMcpName } from "../external.ts";
import packageJson from "../package.json" with { type: "json" };
import { log } from "../utils/cli.ts";
import { installFromNpmTarball } from "../utils/install.ts";
import { type AgentRunContext, agent } from "./shared.ts";

// Model selection based on effort level
// Note: mini uses Haiku for speed, auto uses opusplan for balance, max uses Opus for capability
const claudeEffortModels: Record<Effort, string> = {
  mini: "haiku",
  auto: "opusplan",
  max: "opus",
};

// FUTURE: Consider using Anthropic's "effort" parameter (beta) with Opus 4.5 for all tasks.
// This would allow a single model with effort levels ("low", "medium", "high") controlling
// token spend across responses, tool calls, and thinking. Requires beta header "effort-2025-11-24".
// See: https://platform.claude.com/docs/en/build-with-claude/effort
// This approach could replace model selection if effort proves effective for controlling capability.

/**
 * Build disallowedTools list from payload permissions.
 */
function buildDisallowedTools(ctx: AgentRunContext): string[] {
  const disallowed: string[] = [];
  if (ctx.payload.web === "disabled") disallowed.push("WebFetch");
  if (ctx.payload.search === "disabled") disallowed.push("WebSearch");
  if (ctx.payload.write === "disabled") disallowed.push("Write");
  // both "disabled" and "restricted" block native bash
  // "restricted" means use MCP bash tool instead
  const bash = ctx.payload.bash;
  if (bash !== "enabled") disallowed.push("Bash");
  return disallowed;
}

async function installClaude(): Promise<string> {
  const versionRange = packageJson.dependencies["@anthropic-ai/claude-agent-sdk"] || "latest";
  return await installFromNpmTarball({
    packageName: "@anthropic-ai/claude-agent-sdk",
    version: versionRange,
    executablePath: "cli.js",
  });
}

export const claude = agent({
  name: "claude",
  install: installClaude,
  run: async (ctx) => {
    // install CLI at start of run
    const cliPath = await installClaude();

    // select model based on effort level
    const model = claudeEffortModels[ctx.payload.effort];
    log.info(`» using model: ${model} (effort: ${ctx.payload.effort})`);

    // build disallowedTools based on tool permissions
    const disallowedTools = buildDisallowedTools(ctx);
    if (disallowedTools.length > 0) {
      log.info(`» disallowed tools: ${disallowedTools.join(", ")}`);
    }

    const queryOptions: Options = {
      permissionMode: "bypassPermissions" as const,
      disallowedTools,
      mcpServers: {
        [ghPullfrogMcpName]: { type: "http", url: ctx.mcpServerUrl },
      },
      model,
      pathToClaudeCodeExecutable: cliPath,
      env: process.env,
    };

    const queryInstance = query({
      prompt: ctx.instructions.full,
      options: queryOptions,
    });

    // Stream the results
    for await (const message of queryInstance) {
      log.debug(JSON.stringify(message, null, 2));
      const handler = messageHandlers[message.type];
      await handler(message as never);
    }

    return {
      success: true,
      output: "",
    };
  },
});

type SDKMessageType = SDKMessage["type"];

type SDKMessageHandler<type extends SDKMessageType = SDKMessageType> = (
  data: Extract<SDKMessage, { type: type }>
) => void | Promise<void>;

type SDKMessageHandlers = {
  [type in SDKMessageType]: SDKMessageHandler<type>;
};

// Track bash tool IDs to identify when bash tool results come back
const bashToolIds = new Set<string>();

const messageHandlers: SDKMessageHandlers = {
  assistant: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "text" && content.text?.trim()) {
          log.box(content.text.trim(), { title: "Claude" });
        } else if (content.type === "tool_use") {
          // Track bash tool IDs
          if (content.name === "bash" && content.id) {
            bashToolIds.add(content.id);
          }

          log.toolCall({
            toolName: content.name,
            input: content.input,
          });
        }
      }
    }
  },
  user: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "tool_result") {
          const toolUseId = (content as any).tool_use_id;
          const isBashTool = toolUseId && bashToolIds.has(toolUseId);

          if (isBashTool) {
            // Log bash output in a collapsed group
            const outputContent =
              typeof content.content === "string"
                ? content.content
                : Array.isArray(content.content)
                  ? content.content
                      .map((c: any) => (typeof c === "string" ? c : c.text || JSON.stringify(c)))
                      .join("\n")
                  : String(content.content);

            log.startGroup(`bash output`);
            if (content.is_error) {
              log.warning(outputContent);
            } else {
              log.info(outputContent);
            }
            log.endGroup();
            // Clean up the tracked ID
            bashToolIds.delete(toolUseId);
          } else if (content.is_error) {
            const errorContent =
              typeof content.content === "string" ? content.content : String(content.content);
            log.warning(`Tool error: ${errorContent}`);
          }
        }
      }
    }
  },
  result: async (data) => {
    if (data.subtype === "success") {
      const usage = data.usage;
      const inputTokens = usage?.input_tokens || 0;
      const cacheRead = usage?.cache_read_input_tokens || 0;
      const cacheWrite = usage?.cache_creation_input_tokens || 0;
      const outputTokens = usage?.output_tokens || 0;
      const totalInput = inputTokens + cacheRead + cacheWrite;

      log.table([
        [
          { data: "Cost", header: true },
          { data: "Input", header: true },
          { data: "Cache Read", header: true },
          { data: "Cache Write", header: true },
          { data: "Output", header: true },
        ],
        [
          `$${data.total_cost_usd?.toFixed(4) || "0.0000"}`,
          String(totalInput),
          String(cacheRead),
          String(cacheWrite),
          String(outputTokens),
        ],
      ]);
    } else if (data.subtype === "error_max_turns") {
      log.error(`Max turns reached: ${JSON.stringify(data)}`);
    } else if (data.subtype === "error_during_execution") {
      log.error(`Execution error: ${JSON.stringify(data)}`);
    } else {
      log.error(`Failed: ${JSON.stringify(data)}`);
    }
  },
  system: () => {},
  stream_event: () => {},
  tool_progress: () => {},
  auth_status: () => {},
};
