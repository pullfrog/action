import type { Payload } from "../external.ts";

/**
 * sandbox e2e test fixture.
 * tests that the agent can start and operate with landlock restrictions.
 * the agent should be able to read files but writes should be blocked by landlock.
 *
 * run with: AGENT_OVERRIDE=<agent> pnpm play fixtures/sandbox-test.ts
 */
export default {
  "~pullfrog": true,
  agent: null,
  prompt: `You are running a sandbox test. Please do the following:

1. Read the contents of the README.md file in the current directory and tell me the first line.
2. Try to create a file called "sandbox-write-test.txt" with content "test". Report whether this succeeded or failed.
3. List the files in the current directory.

Report your findings clearly. If file operations fail, that's expected in sandbox mode - just report the error.`,
  event: {
    trigger: "issue_comment_created",
    comment_id: 99999,
    comment_body: "@pullfrog sandbox test",
    issue_number: 1,
  },
  modes: [],
  permissions: {
    readonly: true,
    network: true, // allow network for this test
    bash: false,
  },
} satisfies Payload;
