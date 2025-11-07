#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 */

import * as core from "@actions/core";
import { type Inputs, main } from "./main.ts";
import { createMcpServer } from "./mcp/server.ts";
import packageJson from "./package.json" with { type: "json" };
import { log } from "./utils/cli.ts";

// Export createMcpServer so it can be called from the spawned MCP process
export { createMcpServer };

async function run(): Promise<void> {
  try {
    log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);

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
