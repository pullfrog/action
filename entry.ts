#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 */

import * as core from "@actions/core";
import { type Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";

async function run(): Promise<void> {
  // Change to GITHUB_WORKSPACE if set (this is where actions/checkout puts the repo)
  // JavaScript actions run from the action's directory, not the checked-out repo
  if (process.env.GITHUB_WORKSPACE && process.cwd() !== process.env.GITHUB_WORKSPACE) {
    log.debug(`Changing to GITHUB_WORKSPACE: ${process.env.GITHUB_WORKSPACE}`);
    process.chdir(process.env.GITHUB_WORKSPACE);
    log.debug(`New working directory: ${process.cwd()}`);
  }

  try {
    // Set GITHUB_TOKEN from input if provided (allows fallback to env var)
    const githubTokenInput = core.getInput("github_token");
    if (githubTokenInput) {
      process.env.GITHUB_TOKEN = githubTokenInput;
    }

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
