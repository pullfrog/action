#!/usr/bin/env node

/**
 * entry point for pullfrog/pullfrog/dispatch - JSON payload input for internal use
 */

import * as core from "@actions/core";
import { Inputs, main } from "../main.ts";

async function run(): Promise<void> {
  try {
    const payloadStr = core.getInput("payload", { required: true });

    // parse JSON payload
    let payload: unknown;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      throw new Error(`failed to parse payload as JSON: ${payloadStr.slice(0, 100)}...`);
    }

    // validate and convert to Inputs
    if (typeof payload !== "object" || payload === null) {
      throw new Error("payload must be a JSON object");
    }

    const payloadObj = payload as Record<string, unknown>;

    // build inputs from payload fields
    const inputs = Inputs.assert({
      prompt: payloadObj.prompt,
      effort: payloadObj.effort,
      agent: payloadObj.agent,
      event: payloadObj.event,
      modes: payloadObj.modes,
      // granular tool permissions
      web: payloadObj.web,
      search: payloadObj.search,
      write: payloadObj.write,
      bash: payloadObj.bash,
      disableProgressComment: payloadObj.disableProgressComment,
      comment_id: payloadObj.comment_id,
      issue_id: payloadObj.issue_id,
      pr_id: payloadObj.pr_id,
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
