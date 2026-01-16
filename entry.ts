#!/usr/bin/env node

/**
 * entry point for pullfrog/pullfrog - unified action
 */

import * as core from "@actions/core";
import { main } from "./main.ts";

async function run(): Promise<void> {
  try {
    const result = await main(core);

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

await run();
