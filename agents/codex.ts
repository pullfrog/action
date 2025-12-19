import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Codex, type CodexOptions, type ThreadEvent } from "@openai/codex-sdk";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import {
  agent,
  type ConfigureMcpServersParams,
  installFromNpmTarball,
  setupProcessAgentEnv,
} from "./shared.ts";

export const codex = agent({
  name: "codex",
  install: async () => {
    return await installFromNpmTarball({
      packageName: "@openai/codex",
      version: "latest",
      executablePath: "bin/codex.js",
    });
  },
  run: async ({ payload, mcpServers, apiKey, cliPath, repo }) => {
    // create config directory for codex before setting HOME
    const tempHome = process.env.PULLFROG_TEMP_DIR!;
    const configDir = join(tempHome, ".config", "codex");
    mkdirSync(configDir, { recursive: true });

    setupProcessAgentEnv({
      OPENAI_API_KEY: apiKey,
      HOME: tempHome,
    });

    configureCodexMcpServers({ mcpServers, cliPath });

    // Configure Codex
    const codexOptions: CodexOptions = {
      apiKey,
      codexPathOverride: cliPath,
    };

    if (payload.sandbox) {
      log.info("🔒 sandbox mode enabled: restricting to read-only operations");
    }

    const codex = new Codex(codexOptions);
    // valid sandbox modes: read-only, workspace-write, danger-full-access
    const thread = codex.startThread(
      payload.sandbox
        ? {
            approvalPolicy: "never",
            sandboxMode: "read-only",
            networkAccessEnabled: false,
          }
        : {
            approvalPolicy: "never",
            // use danger-full-access to allow git operations (workspace-write blocks .git directory writes)
            sandboxMode: "danger-full-access",
            networkAccessEnabled: true,
          }
    );

    try {
      const streamedTurn = await thread.runStreamed(addInstructions({ payload, repo }));

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
    await log.summaryTable([
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

/**
 * Configure MCP servers for Codex using the CLI.
 * For HTTP-based servers, use: codex mcp add <name> --url <url>
 */
function configureCodexMcpServers({ mcpServers, cliPath }: ConfigureMcpServersParams): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (serverConfig.type === "http") {
      // HTTP-based MCP server - use --url flag
      const addArgs = ["mcp", "add", serverName, "--url", serverConfig.url];

      log.info(`Adding MCP server '${serverName}' at ${serverConfig.url}...`);
      const addResult = spawnSync("node", [cliPath, ...addArgs], {
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (addResult.status !== 0) {
        throw new Error(
          `codex mcp add failed: ${addResult.stderr || addResult.stdout || "Unknown error"}`
        );
      }
      log.info(`✓ MCP server '${serverName}' configured`);
    } else {
      throw new Error(
        `Unsupported MCP server type for Codex: ${(serverConfig as any).type || "unknown"}`
      );
    }
  }
}
