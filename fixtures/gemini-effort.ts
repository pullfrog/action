import type { Effort, Payload } from "../external.ts";

/**
 * Test fixture for Gemini effort levels.
 * Runs all three effort levels in sequence.
 *
 * Run with:
 *   AGENT_OVERRIDE=gemini pnpm play gemini-effort.ts
 *
 * Effort levels:
 *   - "nothink": gemini-2.5-flash + LOW thinking
 *   - "think": gemini-2.5-flash + HIGH thinking
 *   - "max": gemini-2.5-pro + HIGH thinking
 */

const efforts: Effort[] = ["nothink", "think", "max"];

export default efforts.map((effort) => ({
  "~pullfrog": true,
  agent: "gemini",
  prompt: "What is 2 + 2? Reply with just the number.",
  event: {
    trigger: "workflow_dispatch",
  },
  modes: [],
  effort,
})) satisfies Payload[];
