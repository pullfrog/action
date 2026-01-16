import type { Inputs } from "../../main.ts";

/**
 * smoke test fixture - minimal prompt to verify:
 * 1. agent connects to API
 * 2. MCP server responds
 * 3. select_mode tool works
 */
export default {
  prompt: `Call the select_mode tool with modeName "Build" and confirm you received the mode's prompt instructions. Then say "SMOKE TEST PASSED".`,
  effort: "mini",
} satisfies Inputs;
