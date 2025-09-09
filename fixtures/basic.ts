import type { MainParams } from "../main";

const testParams = {
  prompt: "List all files in the current directory, then create a file called dynamic-test.txt with the content 'This was loaded from a TypeScript file!', then delete it."
} satisfies MainParams;

export default testParams;
