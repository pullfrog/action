/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { fromHere } from "@ark/fs";
import { log } from "../utils/cli.ts";
import { parseRepoContext } from "../utils/github.ts";

export const ghPullfrogMcpName = "gh-pullfrog";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpServerConfig>;

export function createMcpConfigs(githubInstallationToken: string): McpConfigs {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  // In production (GitHub Actions), mcp-server.js is in same directory as entry.js (where this is bundled)
  // In development, server.ts is in the same directory as this file (config.ts)
  const serverPath = process.env.GITHUB_ACTIONS ? fromHere("mcp-server.js") : fromHere("server.ts");

  log.info(`MCP Server Path: ${serverPath}`);
  const pathExists = existsSync(serverPath);
  log.info(`MCP Server Path exists: ${pathExists}`);

  if (!pathExists) {
    const dir = dirname(serverPath);
    log.info(`Directory: ${dir}`);
    try {
      const files = readdirSync(dir);
      log.info(`Files in directory: ${files.join(", ")}`);
    } catch (error) {
      log.warning(
        `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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
