#!/usr/bin/env tsx

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { main } from "./main";
import { runAct } from "./utils/act";

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
        throw new Error(
          `TypeScript file ${filePath} must have a default export`,
        );
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
      throw new Error(
        `Unsupported file type: ${ext}. Supported types: .txt, .json, .ts`,
      );
  }
}

async function runPlay(
  filePath: string,
  options: { act?: boolean },
): Promise<void> {
  try {
    // Load the prompt from the specified file
    const prompt = await loadPrompt(filePath);

    if (options.act) {
      // Use Docker/act to run the action
      console.log("🐳 Running with Docker/act...");
      runAct(prompt);
    } else {
      // Clone the test repository and run directly
      const tempDir = join(process.cwd(), ".temp");
      const repoUrl = "git@github.com:pullfrogai/scratch.git";

      // Remove existing temp directory if it exists
      if (existsSync(tempDir)) {
        console.log("🗑️  Removing existing .temp directory...");
        rmSync(tempDir, { recursive: true, force: true });
      }

      // Clone the repository
      console.log("📦 Cloning pullfrogai/scratch into .temp...");
      execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });

      // List of environment variables to copy to .temp
      const envVarsToCopy = [
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        // Add more environment variables here as needed
      ];

      // Build .env content from the list
      const envLines = envVarsToCopy
        .map((varName) => `${varName}=${process.env[varName] || ""}`)
        .join("\n");

      const envPath = join(tempDir, ".env");
      writeFileSync(envPath, envLines + "\n");
      console.log("📝 Created .env file in .temp directory with:");

      let hasRequiredVars = true;
      envVarsToCopy.forEach((varName) => {
        const hasValue = !!process.env[varName];
        console.log(`   - ${varName}: ${hasValue ? "✓" : "✗ (missing)"}`);

        // Check for required variables
        if (varName === "ANTHROPIC_API_KEY" && !hasValue) {
          hasRequiredVars = false;
        }
      });

      if (!hasRequiredVars) {
        console.warn("\n⚠️  Warning: ANTHROPIC_API_KEY is not set or empty.");
        console.warn(
          "   Please ensure you have a valid API key in your .env file.",
        );
        console.warn(
          "   Get your API key from: https://console.anthropic.com/api-keys\n",
        );
      }

      // Change to the temp directory
      process.chdir(tempDir);

      console.log("🚀 Running test in .temp directory...");
      console.log("─".repeat(50));
      console.log(`Prompt from ${filePath}:`);
      console.log(prompt);
      console.log("─".repeat(50));

      // Run main with the params object
      const result = await main({ prompt });

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
  .argument(
    "[file]",
    "Prompt file to use (.txt, .json, or .ts)",
    "fixtures/basic.txt",
  )
  .option(
    "--act",
    "Use Docker/act to run the action instead of running directly",
  )
  .action(async (file: string, options: { act?: boolean }) => {
    await runPlay(file, options);
  });

// Parse arguments and run
program.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
