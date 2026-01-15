#!/usr/bin/env node

/**
 * entry point for pullfrog/pullfrog/run - itemized inputs for external users
 */

import * as core from "@actions/core";
import { Inputs, main } from "../main.ts";

async function run(): Promise<void> {
  try {
    // granular tool permissions (empty string means not set, use default)
    const web = core.getInput("web") || undefined;
    const search = core.getInput("search") || undefined;
    const write = core.getInput("write") || undefined;
    const bash = core.getInput("bash") || undefined;

    const inputs = Inputs.assert({
      prompt: core.getInput("prompt", { required: true }),
      effort: core.getInput("effort") || "auto",
      agent: core.getInput("agent") || null,
      cwd: core.getInput("cwd") || null,
      web,
      search,
      write,
      bash,
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
