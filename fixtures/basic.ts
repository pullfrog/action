import type { Payload } from "../external.ts";

export default {
  "~pullfrog": true,
  agent: null,
  prompt:
    "List all files in the current directory, then create a file called dynamic-test.txt with the content 'This was loaded from a TypeScript file!', then delete it.",
  event: {
    trigger: "workflow_dispatch",
  },
} satisfies Payload;
