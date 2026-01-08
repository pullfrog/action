import type { Payload } from "../external.ts";

/**
 * test fixture: simulates an @pullfrog mention by a non-collaborator on a public repo.
 * sandbox mode is enabled, so web access and file writes should be blocked.
 *
 * run with: AGENT_OVERRIDE=claude pnpm play sandbox.ts
 */
export default {
  "~pullfrog": true,
  agent: null,
  prompt: `Please do the following three things:

1. Fetch the content from https://httpbin.org/json and tell me what it says
2. Create a file called sandbox-test.txt with the content "This should fail in sandbox mode"
3. Run a bash command: echo "hello from bash" > bash-test.txt

All three of these actions should fail because you are running in sandbox mode with restricted permissions (no Web, no Write, no Bash).`,
  event: {
    trigger: "issue_comment_created",
    comment_id: 12345,
    comment_body: "@pullfrog please fetch from web and write a file",
    issue_number: 1,
  },
  modes: [],
  sandbox: true,
} satisfies Payload;
