import { main } from "./main";

const INPUTS = {
  prompt:
    "Print the list of tools available. Then create a new file called test.txt. Then delete it. Then exit.",
  anthropic_api_key: process.env.ANTHROPIC_API_KEY,
};

// write INPUT_{key} to process.env
for (const [key, value] of Object.entries(INPUTS)) {
  process.env[`INPUT_${key.toUpperCase()}`] = value;
}

// run index.ts
main();
