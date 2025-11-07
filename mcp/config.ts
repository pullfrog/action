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

  // Get absolute path to entry.js - use GITHUB_ACTION_PATH if available, otherwise current directory
  const entryPath = process.env.GITHUB_ACTION_PATH
    ? `${process.env.GITHUB_ACTION_PATH}/entry.js`
    : `${process.cwd()}/entry.js`;

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: [
        "--input-type=module",
        "-e",
        `import('${entryPath.replace(/'/g, "\\'")}').then(m => m.createMcpServer())`,
      ],
      env: {
        GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
        GITHUB_REPOSITORY: githubRepository,
      },
    },
  };
}
