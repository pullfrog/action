/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpServerConfig, McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import { log } from "../utils/cli.ts";
import { parseRepoContext } from "../utils/github.ts";
import { ghPullfrogMcpName } from "./index.ts";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpStdioServerConfig>;

export function createMcpConfigs(githubInstallationToken: string): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  // In production (GitHub Actions), mcp-server.js is in same directory as entry.js (where this is bundled)
  // In development, server.ts is in the same directory as this file (config.ts)
  const serverPath = process.env.GITHUB_ACTIONS ? fromHere("mcp-server") : fromHere("server.ts");

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: [serverPath],
      env: {
        GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
        GITHUB_REPOSITORY: githubRepository,
      },
    },
  };
}

/**
 * Iterate through MCP servers and call the provided handler for each stdio server
 * Shared logic to avoid duplication across agents
 */
export function forEachStdioMcpServer(
  mcpServers: Record<string, McpServerConfig>,
  handler: (serverName: string, serverConfig: McpStdioServerConfig) => void
): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    // Only configure stdio servers (CLIs support stdio MCP servers)
    if (!("command" in serverConfig)) {
      log.warning(`MCP server '${serverName}' is not a stdio server, skipping...`);
      continue;
    }
    handler(serverName, serverConfig);
  }
}
