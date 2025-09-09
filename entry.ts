#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 * This file is bundled to entry.cjs and called directly by GitHub Actions
 */

import * as core from "@actions/core";
import { main } from "./main";

async function run(): Promise<void> {
  try {
    // Get inputs from GitHub Actions
    const prompt = core.getInput("prompt", { required: true });
    const anthropicApiKey = core.getInput("anthropic_api_key", {
      required: true,
    });

    if (!anthropicApiKey) {
      throw new Error("anthropic_api_key is required");
    }

    if (!prompt) {
      throw new Error("prompt is required");
    }

    // Create params object
    const params = {
      prompt,
      anthropicApiKey,
    };

    // Run the main function
    const result = await main(params);

    // Set outputs
    core.setOutput("status", result.success ? "success" : "failed");
    core.setOutput("prompt", prompt);
    core.setOutput("output", result.output || "");

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

// Run the action
run().catch((error) => {
  console.error("Action failed:", error);
  process.exit(1);
});
