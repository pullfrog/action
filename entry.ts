#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 */

import * as core from "@actions/core";
import { Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";

async function run(): Promise<void> {
  // Change to GITHUB_WORKSPACE if set (this is where actions/checkout puts the repo)
  // JavaScript actions run from the action's directory, not the checked out repo
  if (process.env.GITHUB_WORKSPACE && process.cwd() !== process.env.GITHUB_WORKSPACE) {
    log.debug(`Changing to GITHUB_WORKSPACE: ${process.env.GITHUB_WORKSPACE}`);
    process.chdir(process.env.GITHUB_WORKSPACE);
    log.debug(`New working directory: ${process.cwd()}`);
  }

  try {
    const inputs = Inputs.assert({
      prompt: core.getInput("prompt", { required: true }),
      effort: core.getInput("effort") || "think",
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
