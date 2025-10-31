/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import { parseRepoContext } from "../utils/github.ts";

const actionPath = fromHere("..");

export const ghPullfrogMcpName = "gh-pullfrog";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpServerConfig>;

export function createMcpConfigs(githubInstallationToken: string): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: [`${actionPath}/mcp/server.ts`],
      env: {
        GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
        GITHUB_REPOSITORY: githubRepository,
      },
    },
  };
}
