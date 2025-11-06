/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { parseRepoContext } from "../utils/github.ts";

export const ghPullfrogMcpName = "gh-pullfrog";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpServerConfig>;

export function createMcpConfigs(githubInstallationToken: string): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  // Get absolute path to entry.cjs - use GITHUB_ACTION_PATH if available, otherwise current directory
  const entryPath = process.env.GITHUB_ACTION_PATH
    ? `${process.env.GITHUB_ACTION_PATH}/entry.cjs`
    : `${process.cwd()}/entry.cjs`;

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: ["-e", `require('${entryPath.replace(/'/g, "\\'")}').createMcpServer()`],
      env: {
        GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
        GITHUB_REPOSITORY: githubRepository,
      },
    },
  };
}
