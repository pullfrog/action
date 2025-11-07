/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import { parseRepoContext } from "../utils/github.ts";

export const ghPullfrogMcpName = "gh-pullfrog";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpServerConfig>;

export function createMcpConfigs(githubInstallationToken: string): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  const serverPath = process.env.GITHUB_ACTION_PATH
    ? `${process.env.GITHUB_ACTION_PATH}/mcp-server.js`
    : fromHere("server.ts");

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
