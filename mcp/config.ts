/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import type { Mode } from "../modes.ts";
import { parseRepoContext } from "../utils/github.ts";
import { ghPullfrogMcpName } from "../external.ts";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpStdioServerConfig>;

export function createMcpConfigs(githubInstallationToken: string, modes: Mode[]): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  // In production (GitHub Actions), mcp-server.js is in same directory as entry.js (where this is bundled)
  // In development, server.ts is in the same directory as this file (config.ts)
  const serverPath = process.env.GITHUB_ACTIONS ? fromHere("mcp-server.js") : fromHere("server.ts");

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: [serverPath],
      env: {
        GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
        GITHUB_REPOSITORY: githubRepository,
        PULLFROG_MODES: JSON.stringify(modes),
      },
    },
  };
}
