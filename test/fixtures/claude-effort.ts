import type { Effort, Payload } from "../../external.ts";

/**
 * Test fixture for Claude effort levels.
 * Runs all three effort levels in sequence.
 *
 * Run with:
 *   AGENT_OVERRIDE=claude pnpm play claude-effort.ts
 *
 * Effort levels:
 *   - "mini": haiku (fast, efficient)
 *   - "auto": opusplan (Opus for planning, Sonnet for execution)
 *   - "max": opus (full Opus capability)
 */

const efforts: Effort[] = ["mini", "auto", "max"];

export default efforts.map((effort) => ({
  "~pullfrog": true,
  agent: "claude",
  prompt: "What is 2 + 2? Reply with just the number.",
  event: {
    trigger: "workflow_dispatch",
  },
  modes: [],
  effort,
})) satisfies Payload[];
