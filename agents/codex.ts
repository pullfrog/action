import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Codex,
  type CodexOptions,
  type ModelReasoningEffort,
  type ThreadEvent,
  type ThreadOptions,
} from "@openai/codex-sdk";
import type { Effort } from "../external.ts";
import { ghPullfrogMcpName } from "../external.ts";
import { log } from "../utils/cli.ts";
import { installFromNpmTarball } from "../utils/install.ts";
import { type AgentRunContext, agent } from "./shared.ts";

// model configuration based on effort level
const codexModel: Record<Effort, string> = {
  mini: "gpt-5.1-codex-mini",
  // https://developers.openai.com/codex/models/
  // gpt-5.2-codex is not yet available via api key (even through codex cli)
  auto: "gpt-5.1-codex",
  max: "gpt-5.1-codex-max",
} as const;

// reasoning effort configuration based on effort level
// uses modelReasoningEffort parameter from ThreadOptions
const codexReasoningEffort: Record<Effort, ModelReasoningEffort | undefined> = {
  mini: "low",
  auto: undefined, // use default
  max: "high",
};

function writeCodexConfig(ctx: AgentRunContext): string {
  const codexDir = join(ctx.tmpdir, ".codex");
  mkdirSync(codexDir, { recursive: true });
  const configPath = join(codexDir, "config.toml");

  // build MCP servers section
  log.info(`» adding MCP server '${ghPullfrogMcpName}' at ${ctx.mcpServerUrl}`);
  const mcpServerSections = [`[mcp_servers.${ghPullfrogMcpName}]\nurl = "${ctx.mcpServerUrl}"`];

  // build features section for tool control
  // disable native shell if bash is "disabled" or "restricted"
  // when "restricted", agent uses MCP bash tool which filters secrets
  const features: string[] = [];
  if (ctx.tools.bash !== "enabled") {
    features.push("shell_command_tool = false");
    features.push("unified_exec = false");
  }
  const featuresSection = features.length > 0 ? `[features]\n${features.join("\n")}` : "";

  writeFileSync(
    configPath,
    `# written by pullfrog
${featuresSection}

${mcpServerSections.join("\n\n")}
`.trim() + "\n"
  );

  log.info(
    `» Codex config written to ${configPath} (shell: ${ctx.tools.bash === "enabled" ? "enabled" : "disabled"})`
  );

  return codexDir;
}

async function installCodex(): Promise<string> {
  return await installFromNpmTarball({
    packageName: "@openai/codex",
    version: "latest",
    executablePath: "bin/codex.js",
  });
}

export const codex = agent({
  name: "codex",
  install: installCodex,
  run: async (ctx) => {
    // install CLI at start of run
    const cliPath = await installCodex();

    // create config directory for codex before setting HOME
    const configDir = join(ctx.tmpdir, ".config", "codex");
    mkdirSync(configDir, { recursive: true });

    const codexDir = writeCodexConfig(ctx);

    process.env.HOME = ctx.tmpdir;
    process.env.CODEX_HOME = codexDir;

    // get model and reasoning effort based on effort level
    const model = codexModel[ctx.effort];
    const modelReasoningEffort = codexReasoningEffort[ctx.effort];
    log.info(`» using model: ${model}`);
    if (modelReasoningEffort) {
      log.info(`» using modelReasoningEffort: ${modelReasoningEffort}`);
    }

    // Configure Codex
    const codexOptions: CodexOptions = {
      apiKey: ctx.apiKey,
      codexPathOverride: cliPath,
    };

    const codex = new Codex(codexOptions);

    // build thread options based on tool permissions
    const threadOptions: ThreadOptions = {
      model,
      approvalPolicy: "never" as const,
      // write: "disabled" → read-only sandbox, otherwise full access for git ops
      sandboxMode: ctx.tools.write === "disabled" ? "read-only" : "danger-full-access",
      // web: controls network access
      networkAccessEnabled: ctx.tools.web !== "disabled",
      // search: controls web search
      webSearchEnabled: ctx.tools.search !== "disabled",
      ...(modelReasoningEffort && { modelReasoningEffort }),
    };

    log.info(
      `» Codex options: sandboxMode=${threadOptions.sandboxMode}, networkAccessEnabled=${threadOptions.networkAccessEnabled}, webSearchEnabled=${threadOptions.webSearchEnabled}`
    );

    const thread = codex.startThread(threadOptions);

    try {
      const streamedTurn = await thread.runStreamed(ctx.instructions);

      let finalOutput = "";
      for await (const event of streamedTurn.events) {
        const handler = messageHandlers[event.type];
        log.debug(JSON.stringify(event, null, 2));
        if (handler) {
          handler(event as never);
        }

        if (event.type === "item.completed" && event.item.type === "agent_message") {
          finalOutput = event.item.text;
        }
      }

      return {
        success: true,
        output: finalOutput,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Codex execution failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: "",
      };
    }
  },
});

// Track command execution IDs to identify when command results come back
const commandExecutionIds = new Set<string>();

type ThreadEventHandler<type extends ThreadEvent["type"]> = (
  event: Extract<ThreadEvent, { type: type }>
) => void;

const messageHandlers: {
  [type in ThreadEvent["type"]]: ThreadEventHandler<type>;
} = {
  "thread.started": () => {
    // No logging needed
  },
  "turn.started": () => {
    // No logging needed
  },
  "turn.completed": async (event) => {
    log.table([
      [
        { data: "Input Tokens", header: true },
        { data: "Cached Input Tokens", header: true },
        { data: "Output Tokens", header: true },
      ],
      [
        String(event.usage.input_tokens || 0),
        String(event.usage.cached_input_tokens || 0),
        String(event.usage.output_tokens || 0),
      ],
    ]);
  },
  "turn.failed": (event) => {
    log.error(`Turn failed: ${event.error.message}`);
  },
  "item.started": (event) => {
    const item = event.item;
    if (item.type === "command_execution") {
      commandExecutionIds.add(item.id);
      log.toolCall({
        toolName: item.command,
        input: (item as any).args || {},
      });
    } else if (item.type === "agent_message") {
      // Will be handled on completion
    } else if (item.type === "mcp_tool_call") {
      log.toolCall({
        toolName: item.tool,
        input: {
          server: item.server,
          ...((item as any).arguments || {}),
        },
      });
    }
    // Reasoning items are handled on completion for better readability
  },
  "item.updated": (event) => {
    const item = event.item;
    if (item.type === "command_execution") {
      if (item.status === "in_progress" && item.aggregated_output) {
        // Command is still running, could show progress if needed
      }
    }
  },
  "item.completed": (event) => {
    const item = event.item;
    if (item.type === "agent_message") {
      log.box(item.text.trim(), { title: "Codex" });
    } else if (item.type === "command_execution") {
      const isTracked = commandExecutionIds.has(item.id);
      if (isTracked) {
        log.startGroup(`bash output`);
        if (item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0)) {
          log.warning(item.aggregated_output || "Command failed");
        } else {
          log.info(item.aggregated_output || "");
        }
        log.endGroup();
        commandExecutionIds.delete(item.id);
      }
    } else if (item.type === "mcp_tool_call") {
      if (item.status === "failed" && item.error) {
        log.warning(`MCP tool call failed: ${item.error.message}`);
      }
    } else if (item.type === "reasoning") {
      // Display reasoning in a human-readable format
      const reasoningText = item.text.trim();
      // Remove markdown bold markers if present for cleaner output
      const cleanText = reasoningText.replace(/\*\*/g, "");
      log.box(cleanText, { title: "Codex" });
    }
  },
  error: (event) => {
    log.error(`Error: ${event.message}`);
  },
};
