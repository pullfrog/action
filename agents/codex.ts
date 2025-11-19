import { spawnSync } from "node:child_process";
import { Codex, type CodexOptions, type ThreadEvent } from "@openai/codex-sdk";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromNpmTarball } from "./shared.ts";

export const codex = agent({
  name: "codex",
  inputKeys: ["openai_api_key"],
  install: async () => {
    return await installFromNpmTarball({
      packageName: "@openai/codex",
      version: "latest",
      executablePath: "bin/codex.js",
    });
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath, githubInstallationToken }) => {
    process.env.OPENAI_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    configureCodexMcpServers({ mcpServers, cliPath });

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
        const handler = messageHandlers[event.type];
        if (handler) {
          handler(event as never);
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
      log.info(`→ ${item.command}`);
      commandExecutionIds.add(item.id);
    } else if (item.type === "agent_message") {
      // Will be handled on completion
    } else if (item.type === "mcp_tool_call") {
      log.info(`→ ${item.tool} (${item.server})`);
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
      log.info(cleanText);
    }
  },
  error: (event) => {
    log.error(`Error: ${event.message}`);
  },
};

/**
 * Configure MCP servers for Codex using the CLI.
 * Codex CLI syntax: codex mcp add <name> --env KEY=value -- <command> [args...]
 */
function configureCodexMcpServers({ mcpServers, cliPath }: ConfigureMcpServersParams): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const command = serverConfig.command;
    const args = serverConfig.args || [];
    const envVars = serverConfig.env || {};

    const addArgs = ["mcp", "add", serverName];

    // Add environment variables as --env flags first
    for (const [key, value] of Object.entries(envVars)) {
      addArgs.push("--env", `${key}=${value}`);
    }

    addArgs.push("--", command, ...args);

    log.info(`Adding MCP server '${serverName}'...`);
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
  }
}
