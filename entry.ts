#!/usr/bin/env node

/**
 * Entry point for GitHub Action
 */

import * as core from "@actions/core";
import { type } from "arktype";
import { Inputs, main } from "./main.ts";
import packageJson from "./package.json" with { type: "json" };

async function run(): Promise<void> {
  try {
    console.log(`🐸 Running pullfrog/action@${packageJson.version}...`);

    const inputsJson = process.env.INPUTS_JSON;
    if (!inputsJson) {
      throw new Error("INPUTS_JSON environment variable not found");
    }

    const parsed = type("string.json.parse").assert(inputsJson);
    const inputs = Inputs.assert(parsed);

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
