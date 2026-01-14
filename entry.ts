#!/usr/bin/env node

/**
 * entry point for pullfrog/pullfrog - main action
 */

import * as core from "@actions/core";
import { Inputs, main } from "./main.ts";

async function run(): Promise<void> {
  try {
    const inputs = Inputs.assert({
      prompt: core.getInput("prompt", { required: true }),
      effort: core.getInput("effort") || "think",
      cwd: core.getInput("cwd") || null,
    });

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
