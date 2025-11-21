/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import type { Payload } from "../external.ts";
import { ghPullfrogMcpName } from "../external.ts";
import type { Mode } from "../modes.ts";
import { parseRepoContext } from "../utils/github.ts";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpStdioServerConfig>;

export function createMcpConfigs(
  githubInstallationToken: string,
  modes: Mode[],
  payload: Payload
): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  // In production (GitHub Actions), mcp-server is in same directory as entry.js (where this is bundled)
  // In development, server.ts is in the same directory as this file (config.ts)
  const serverPath = process.env.GITHUB_ACTIONS ? fromHere("mcp-server") : fromHere("server.ts");

  const env: Record<string, string> = {
    GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
    GITHUB_REPOSITORY: githubRepository,
    PULLFROG_MODES: JSON.stringify(modes),
    PULLFROG_PAYLOAD: JSON.stringify(payload),
    PULLFROG_TEMP_DIR: process.env.PULLFROG_TEMP_DIR!,
  };

  // pass through GITHUB_RUN_ID if available (automatically set in GitHub Actions)
  if (process.env.GITHUB_RUN_ID) {
    env.GITHUB_RUN_ID = process.env.GITHUB_RUN_ID;
  }

  return {
    [ghPullfrogMcpName]: {
      command: "node",
      args: [serverPath],
      env,
    },
  };
}
