import type { Inputs } from "../../main.ts";

/**
 * test fixture: tests granular tool permissions enforcement.
 * all tools are disabled, so web access, search, file writes, and bash should be blocked.
 *
 * run with: AGENT_OVERRIDE=claude pnpm play sandbox.ts
 */
export default {
  prompt: `Please do the following three things:

1. Fetch the content from https://httpbin.org/json and tell me what it says
2. Create a file called sandbox-test.txt with the content "This should fail with write disabled"
3. Run a bash command: echo "hello from bash" > bash-test.txt

All three of these actions should fail because tool permissions are restricted (web=disabled, write=disabled, bash=disabled).`,
  // granular tool permissions - all disabled
  web: "disabled",
  search: "disabled",
  write: "disabled",
  bash: "disabled",
} satisfies Inputs;
