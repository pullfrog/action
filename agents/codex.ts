import { spawnSync } from "node:child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Codex, type CodexOptions, type ThreadEvent } from "@openai/codex-sdk";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, installFromNpmTarball } from "./shared.ts";

export const codex = agent({
  name: "codex",
  inputKey: "openai_api_key",
  install: async () => {
    return await installFromNpmTarball({
      packageName: "@openai/codex",
      version: "latest",
      executablePath: "bin/codex.js",
    });
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath }) => {
    process.env.OPENAI_API_KEY = apiKey;

    // Configure MCP servers for Codex (global config is fine - not part of repo)
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      configureMcpServers({ mcpServers, apiKey, cliPath });
    }

    // Configure Codex
    const codexOptions: CodexOptions = {
      apiKey,
      codexPathOverride: cliPath,
    };

    const codex = new Codex(codexOptions);
    // Configure thread options to match Claude's permissions (bypassPermissions)
    // approvalPolicy: "never" = no approval needed (equivalent to bypassPermissions)
    // sandboxMode: "workspace-write" = allow file writes
    // networkAccessEnabled: true = allow network access (needed for GitHub API calls)
    const thread = codex.startThread({
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    });

    try {
      // Use runStreamed to get streaming events similar to claude.ts
      const streamedTurn = await thread.runStreamed(addInstructions(prompt));

      // Stream events and handle them
      let finalOutput = "";
      for await (const event of streamedTurn.events) {
        const handler = messageHandlers[event.type as keyof typeof messageHandlers];
        if (handler) {
          await handler(event);
        }

        // Capture final response from agent messages
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

type ThreadEventHandler = (event: ThreadEvent) => void | Promise<void>;

const messageHandlers: Partial<Record<ThreadEvent["type"], ThreadEventHandler>> = {
  "thread.started": (event) => {
    if (event.type === "thread.started") {
      log.info(`Thread started: ${event.thread_id}`);
    }
  },
  "turn.started": () => {
    log.info("Turn started");
  },
  "turn.completed": async (event) => {
    if (event.type === "turn.completed") {
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
    }
  },
  "turn.failed": (event) => {
    if (event.type === "turn.failed") {
      log.error(`Turn failed: ${event.error.message}`);
    }
  },
  "item.started": (event) => {
    if (event.type === "item.started") {
      const item = event.item;
      if (item.type === "command_execution") {
        log.info(`→ ${item.command}`);
        commandExecutionIds.add(item.id);
      } else if (item.type === "agent_message") {
        // Will be handled on completion
      } else if (item.type === "mcp_tool_call") {
        log.info(`→ ${item.tool} (${item.server})`);
      } else if (item.type === "reasoning") {
        const preview = item.text.length > 100 ? `${item.text.substring(0, 100)}...` : item.text;
        log.info(`→ reasoning: ${preview}`);
      } else {
        log.info(`→ ${item.type}`);
      }
    }
  },
  "item.updated": (event) => {
    if (event.type === "item.updated") {
      const item = event.item;
      if (item.type === "command_execution") {
        if (item.status === "in_progress" && item.aggregated_output) {
          // Command is still running, could show progress if needed
        }
      }
    }
  },
  "item.completed": (event) => {
    if (event.type === "item.completed") {
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
      }
    }
  },
  error: (event) => {
    if (event.type === "error") {
      log.error(`Error: ${event.message}`);
    }
  },
};

function configureMcpServers({
  mcpServers,
  apiKey,
  cliPath,
}: {
  mcpServers: Record<string, McpServerConfig>;
  apiKey: string;
  cliPath: string;
}): void {
  log.info("Configuring MCP servers for Codex...");
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    // Only configure stdio servers (Codex CLI supports stdio MCP servers)
    // Check if it's a stdio server config (has 'command' property)
    if (!("command" in serverConfig)) {
      log.warning(`MCP server '${serverName}' is not a stdio server, skipping...`);
      continue;
    }

    // Build command and args
    const command = serverConfig.command;
    const args = serverConfig.args || [];
    const envVars = serverConfig.env || {};

    // Build the codex mcp add command with proper argument handling
    const addArgs = ["mcp", "add", serverName, "--", command, ...args];

    // Add environment variables as --env flags
    for (const [key, value] of Object.entries(envVars)) {
      addArgs.push("--env", `${key}=${value}`);
    }

    log.info(`Adding MCP server '${serverName}'...`);
    const addResult = spawnSync("node", [cliPath, ...addArgs], {
      stdio: "pipe",
      encoding: "utf-8",
      env: {
        ...process.env,
        OPENAI_API_KEY: apiKey,
      },
    });

    if (addResult.status !== 0) {
      throw new Error(
        `codex mcp add failed: ${addResult.stderr || addResult.stdout || "Unknown error"}`
      );
    }
    log.info(`✓ MCP server '${serverName}' configured`);
  }
}
