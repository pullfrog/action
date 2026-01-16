import type { Payload } from "../../external.ts";

/**
 * test fixture: verifies agents use MCP bash tool for shell commands.
 * creates a simple test file and runs it with node.
 *
 * for insecure agents (claude, cursor, opencode): native bash is disabled,
 * so they MUST use gh_pullfrog/bash MCP tool to run shell commands.
 *
 * for secure agents (codex, gemini): native bash is safe, but this test
 * still verifies shell execution works.
 *
 * run with: AGENT_OVERRIDE=<agent> pnpm play bash-test.ts
 */
export default {
  "~pullfrog": true,
  agent: null,
  prompt: `Create a file called test-runner.js with the following content:

\`\`\`javascript
const assert = require('assert');
assert.strictEqual(2 + 2, 4, 'math should work');
console.log('TEST PASSED: basic arithmetic works');
\`\`\`

Then run it with: node test-runner.js

Finally, delete the test file.

This tests that you can execute shell commands properly.`,
  event: {
    trigger: "workflow_dispatch",
  },
} satisfies Payload;
