#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 * This file is bundled to entry.cjs and called directly by GitHub Actions
 */

import * as core from "@actions/core";
import { type ExecutionInputs, type MainParams, main } from "./main.ts";
import { setupGitHubInstallationToken } from "./utils/github.ts";

async function run(): Promise<void> {
  try {
    const prompt = core.getInput("prompt", { required: true });
    const anthropic_api_key = core.getInput("anthropic_api_key");

    if (!prompt) {
      throw new Error("prompt is required");
    }

    const inputs: ExecutionInputs = {
      prompt,
      anthropic_api_key,
    };

    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN;
    if (githubToken) {
      inputs.github_token = githubToken;
    }

    const githubInstallationToken =
      core.getInput("github_installation_token") || process.env.GITHUB_INSTALLATION_TOKEN;
    if (githubInstallationToken) {
      inputs.github_installation_token = githubInstallationToken;
    } else {
      await setupGitHubInstallationToken();
    }

    const params: MainParams = {
      inputs,
      env: {},
      cwd: process.cwd(),
    };

    const result = await main(params);


    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

run().catch((error) => {
  console.error("Action failed:", error);
  process.exit(1);
});
