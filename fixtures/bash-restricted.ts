import type { Inputs } from "../main.ts";

/**
 * test fixture: tests bash=restricted enforcement.
 * the agent should use MCP bash tool (not native bash).
 *
 * run with: AGENT_OVERRIDE=claude pnpm play bash-restricted.ts
 */
export default {
  prompt: `Run this bash command: echo "hello from restricted mode"

Use the gh_pullfrog/bash MCP tool since native bash is disabled for security.`,
  bash: "restricted",
} satisfies Inputs;
