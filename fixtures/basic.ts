import type { Inputs } from "../main.ts";

const testParams = {
  prompt:
    "List all files in the current directory, then create a file called dynamic-test.txt with the content 'This was loaded from a TypeScript file!', then delete it.",
  anthropic_api_key: "sk-test-key",
} satisfies Inputs;

export default testParams;
