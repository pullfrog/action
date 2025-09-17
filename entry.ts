#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 * This file is bundled to entry.cjs and called directly by GitHub Actions
 */

import * as core from "@actions/core";
import { type MainParams, main } from "./main.ts";
import { setupGitHubInstallationToken } from "./utils/github.ts";

async function run(): Promise<void> {
  try {
    // Get inputs from GitHub Actions
    const prompt = core.getInput("prompt", { required: true });
    const anthropicApiKey = core.getInput("anthropic_api_key");

    if (!prompt) {
      throw new Error("prompt is required");
    }

    // Create params object with new structure
    const inputs: any = {
      prompt,
      anthropic_api_key: anthropicApiKey,
    };

    // Add optional properties only if they exist
    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN;
    if (githubToken) {
      inputs.github_token = githubToken;
    }

    const githubInstallationToken =
      core.getInput("github_installation_token") || process.env.GITHUB_INSTALLATION_TOKEN;
    if (githubInstallationToken) {
      inputs.github_installation_token = githubInstallationToken;
    } else {
      // Setup GitHub installation token
      await setupGitHubInstallationToken();
    }

    const params: MainParams = {
      inputs,
      env: {},
      cwd: process.cwd(),
    };

    // Run the main function
    const result = await main(params);

    // TODO: Set outputs

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

// Run the action
run().catch((error) => {
  console.error("Action failed:", error);
  process.exit(1);
});
