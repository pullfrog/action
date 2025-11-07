#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as core from "@actions/core";
import { type Inputs, main } from "./main.ts";
import { createMcpServer } from "./mcp/server.ts";
import { log } from "./utils/cli.ts";

// Export createMcpServer so it can be called from the spawned MCP process
export { createMcpServer };

async function printDirectoryTree(dir: string, prefix = "", rootDir = dir): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const currentPrefix = isLast ? "└── " : "├── ";
    const nextPrefix = isLast ? "    " : "│   ";

    const fullPath = join(dir, entry.name);
    lines.push(`${prefix}${currentPrefix}${entry.name}`);

    if (entry.isDirectory()) {
      const subTree = await printDirectoryTree(fullPath, `${prefix}${nextPrefix}`, rootDir);
      lines.push(subTree);
    }
  }

  return lines.join("\n");
}

async function run(): Promise<void> {
  // Debug: Print current directory tree before changing directories
  const cwd = process.cwd();
  log.info(`Current working directory: ${cwd}`);
  try {
    const tree = await printDirectoryTree(cwd);
    log.info(`Directory tree:\n${tree}`);
  } catch (error) {
    log.warning(
      `Failed to print directory tree: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Change to GITHUB_WORKSPACE if set (this is where actions/checkout puts the repo)
  // JavaScript actions run from the action's directory, not the checked-out repo
  if (process.env.GITHUB_WORKSPACE && process.cwd() !== process.env.GITHUB_WORKSPACE) {
    log.debug(`Changing to GITHUB_WORKSPACE: ${process.env.GITHUB_WORKSPACE}`);
    process.chdir(process.env.GITHUB_WORKSPACE);
    log.debug(`New working directory: ${process.cwd()}`);
  }

  try {
    const inputs: Inputs = {
      prompt: core.getInput("prompt", { required: true }),
      anthropic_api_key: core.getInput("anthropic_api_key") || undefined,
    };

    const result = await main(inputs);

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

await run();
