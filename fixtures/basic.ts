import type { MainParams } from "../main";

const testParams = {
  inputs: {
    prompt:
      "List all files in the current directory, then create a file called dynamic-test.txt with the content 'This was loaded from a TypeScript file!', then delete it.",
    anthropic_api_key: "sk-test-key",
  },
  env: {},
  cwd: process.cwd(),
} satisfies MainParams;

export default testParams;
