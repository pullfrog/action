import type { Inputs } from "../main.ts";

/**
 * test fixture: tests bash=disabled enforcement.
 * the agent should NOT be able to run bash commands.
 *
 * run with: AGENT_OVERRIDE=claude pnpm play bash-disabled.ts
 */
export default {
  prompt: `Run a simple bash command: echo "hello world"

If you cannot run this command, explain that bash is disabled.`,
  bash: "disabled",
} satisfies Inputs;
