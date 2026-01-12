import type { Effort, Payload } from "../external.ts";

/**
 * Test fixture for Cursor effort levels.
 * Runs all three effort levels in sequence.
 *
 * Run with:
 *   AGENT_OVERRIDE=cursor pnpm play cursor-effort.ts
 *
 * Effort levels:
 *   - "nothink": auto (default model)
 *   - "think": auto (default model)
 *   - "max": opus-4.5-thinking
 *
 * Note: If project has .cursor/cli.json with "model" specified,
 * that takes precedence over effort-based model selection.
 */

const efforts: Effort[] = ["nothink", "think", "max"];

export default efforts.map((effort) => ({
  "~pullfrog": true,
  agent: "cursor",
  prompt: "What is 2 + 2? Reply with just the number.",
  event: {
    trigger: "workflow_dispatch",
  },
  modes: [],
  effort,
})) satisfies Payload[];
