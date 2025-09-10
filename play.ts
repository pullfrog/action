import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { config } from "dotenv";
import { main } from "./main";
import { runAct } from "./utils/act";
import { setupTestRepo } from "./utils/setup";

// Load environment variables from .env file
config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadPrompt(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  // Try to resolve the file path
  let resolvedPath: string;

  // First try as fixtures path
  const fixturesPath = join(__dirname, "fixtures", filePath);
  if (existsSync(fixturesPath)) {
    resolvedPath = fixturesPath;
  } else if (existsSync(filePath)) {
    resolvedPath = resolve(filePath);
  } else {
    throw new Error(`File not found: ${filePath}`);
  }

  switch (ext) {
    case ".txt": {
      // Plain text - pass directly as prompt
      return readFileSync(resolvedPath, "utf8").trim();
    }

    case ".json": {
      // JSON - stringify and pass as prompt
      const content = readFileSync(resolvedPath, "utf8");
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    }

    case ".ts": {
      // TypeScript - dynamic import and stringify default export
      const fileUrl = pathToFileURL(resolvedPath).href;
      const module = await import(fileUrl);

      if (!module.default) {
        throw new Error(`TypeScript file ${filePath} must have a default export`);
      }

      // If it's a string, use it directly
      if (typeof module.default === "string") {
        return module.default;
      }

      // If it's a MainParams object with a prompt field, extract the prompt
      if (typeof module.default === "object" && module.default.prompt) {
        return module.default.prompt;
      }

      // Otherwise stringify it
      return JSON.stringify(module.default, null, 2);
    }

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .json, .ts`);
  }
}

async function runPlay(filePath: string, options: { act?: boolean }): Promise<void> {
  try {
    // Load the prompt from the specified file
    const prompt = await loadPrompt(filePath);

    if (options.act) {
      // Use Docker/act to run the action
      console.log("🐳 Running with Docker/act...");
      runAct(prompt);
    } else {
      // Setup test repository and run directly
      const tempDir = join(process.cwd(), ".temp");
      setupTestRepo({ tempDir, forceClean: true });

      // Change to the temp directory
      process.chdir(tempDir);

      console.log("🚀 Running test in .temp directory...");
      console.log("─".repeat(50));
      console.log(`Prompt from ${filePath}:`);
      console.log(prompt);
      console.log("─".repeat(50));

      // Set environment variables from our .env for the action to use
      const { EXPECTED_INPUTS } = await import("./main");
      EXPECTED_INPUTS.forEach((inputName) => {
        const value = process.env[inputName];
        if (value) {
          process.env[`INPUT_${inputName.toLowerCase()}`] = value;
        }
      });

      // Run main with the new params structure
      const inputs: any = {
        prompt,
        anthropic_api_key: process.env.ANTHROPIC_API_KEY || "",
      };
      
      // Add optional properties only if they exist
      if (process.env.GITHUB_TOKEN) {
        inputs.github_token = process.env.GITHUB_TOKEN;
      }
      
      if (process.env.GITHUB_INSTALLATION_TOKEN) {
        inputs.github_installation_token = process.env.GITHUB_INSTALLATION_TOKEN;
      }

      const result = await main({
        inputs,
        env: process.env as Record<string, string>,
        cwd: process.cwd(),
      });

      if (result.success) {
        console.log("✅ Test completed successfully");
        if (result.output) {
          console.log("Output:", result.output);
        }
      } else {
        console.error("❌ Test failed:", result.error);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
    process.exit(1);
  }
}

// Set up CLI
const program = new Command();

program
  .name("play")
  .description("Test the Pullfrog action with various prompts")
  .version("1.0.0")
  .argument("[file]", "Prompt file to use (.txt, .json, or .ts)", "fixtures/basic.txt")
  .option("--act", "Use Docker/act to run the action instead of running directly")
  .action(async (file: string, options: { act?: boolean }) => {
    await runPlay(file, options);
  });

// Parse arguments and run
program.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
