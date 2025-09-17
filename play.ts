import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { config } from "dotenv";
import { main } from "./main.ts";
import { runAct } from "./utils/act.ts";
import { setupTestRepo } from "./utils/setup.ts";
import { parseGitHubContext, type MockGitHubContext } from "./github/context.ts";
import { detectMode, getModeDescription } from "./github/modes.ts";
import { enhancePromptWithContext, extractTriggerPrompt } from "./github/prompt-enhancer.ts";

// Load environment variables from .env file
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadFixture(filePath: string): Promise<{ prompt?: string; mockContext?: MockGitHubContext; mainParams?: any }> {
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
      return { prompt: readFileSync(resolvedPath, "utf8").trim() };
    }

    case ".json": {
      // JSON - stringify and pass as prompt
      const content = readFileSync(resolvedPath, "utf8");
      const parsed = JSON.parse(content);
      return { prompt: JSON.stringify(parsed, null, 2) };
    }

    case ".ts": {
      // TypeScript - dynamic import and handle different fixture types
      const fileUrl = pathToFileURL(resolvedPath).href;
      const module = await import(fileUrl);

      if (!module.default) {
        throw new Error(`TypeScript file ${filePath} must have a default export`);
      }

      // If it's a string, use it directly as prompt
      if (typeof module.default === "string") {
        return { prompt: module.default };
      }

      // If it's a MainParams object (agent mode fixture)
      if (typeof module.default === "object" && module.default.inputs) {
        return { mainParams: module.default };
      }

      // If it's a MockGitHubContext object (tag mode fixture)
      if (typeof module.default === "object" && module.default.eventName) {
        return { mockContext: module.default };
      }

      // If it's an object with prompt field, extract the prompt
      if (typeof module.default === "object" && module.default.prompt) {
        return { prompt: module.default.prompt };
      }

      // Otherwise stringify it
      return { prompt: JSON.stringify(module.default, null, 2) };
    }

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .json, .ts`);
  }
}

async function runPlay(filePath: string, options: { act?: boolean }): Promise<void> {
  try {
    // Load the fixture from the specified file
    const fixture = await loadFixture(filePath);

    if (options.act) {
      // Use Docker/act to run the action
      console.log("🐳 Running with Docker/act...");
      const prompt = fixture.prompt || "Default prompt for act";
      runAct(prompt);
    } else {
      // Setup test repository and run directly
      const tempDir = join(process.cwd(), ".temp");
      setupTestRepo({ tempDir, forceClean: true });

      // Change to the temp directory
      process.chdir(tempDir);

      console.log("🚀 Running test in .temp directory...");
      console.log("─".repeat(50));

      // Handle different fixture types
      if (fixture.mainParams) {
        // Agent mode fixture - use MainParams directly
        console.log(`Agent mode fixture from ${filePath}`);
        console.log(`Prompt: ${fixture.mainParams.inputs.prompt}`);
        console.log("─".repeat(50));
        
        const result = await main(fixture.mainParams);
        
        if (result.success) {
          console.log("✅ Test completed successfully");
          if (result.output) {
            console.log("Output:", result.output);
          }
        } else {
          console.error("❌ Test failed:", result.error);
          process.exit(1);
        }
        return;
      }

      // Parse GitHub context (either from fixture or environment)
      const context = parseGitHubContext(fixture.mockContext);
      const mode = detectMode(context);
      
      console.log(`GitHub Event: ${context.eventName}`);
      console.log(`Mode: ${mode} (${getModeDescription(mode)})`);
      console.log(`Repository: ${context.repository.full_name}`);
      console.log(`Actor: ${context.actor}`);
      
      if (context.eventName !== "workflow_dispatch") {
        console.log(`Entity: ${(context as any).isPR ? "PR" : "Issue"} #${(context as any).entityNumber}`);
      }
      
      console.log("─".repeat(50));

      // Determine the prompt based on mode
      let basePrompt = "";
      
      if (mode === "tag") {
        // Extract prompt from GitHub context
        basePrompt = extractTriggerPrompt(context) || "Please help with this issue/PR";
        console.log(`Trigger prompt extracted: ${basePrompt}`);
      } else {
        // Use provided prompt or default
        basePrompt = fixture.prompt || context.inputs.prompt || "Analyze this repository";
        console.log(`Agent prompt: ${basePrompt}`);
      }

      // Enhance prompt with GitHub context
      const enhanced = enhancePromptWithContext(basePrompt, context);
      
      console.log("\n📝 Enhanced prompt with context:");
      console.log(enhanced.contextualPrompt);
      console.log("─".repeat(50));

      // Set environment variables from our .env for the action to use
      const { EXPECTED_INPUTS } = await import("./main.ts");
      EXPECTED_INPUTS.forEach((inputName) => {
        const value = process.env[inputName];
        if (value) {
          process.env[`INPUT_${inputName.toLowerCase()}`] = value;
        }
      });

      // Run main with the enhanced prompt
      const inputs: any = {
        prompt: enhanced.contextualPrompt,
        anthropic_api_key: process.env.ANTHROPIC_API_KEY || "",
      };

      // Add optional properties only if they exist
      if (process.env.GITHUB_TOKEN) {
        inputs.github_token = process.env.GITHUB_TOKEN;
      }

      if (process.env.GITHUB_INSTALLATION_TOKEN) {
        inputs.github_installation_token = process.env.GITHUB_INSTALLATION_TOKEN;
      }

      // Set up environment variables to simulate GitHub context
      const testEnv = {
        ...process.env,
        GITHUB_EVENT_NAME: context.eventName,
        GITHUB_ACTOR: context.actor,
        GITHUB_REPOSITORY: context.repository.full_name,
        GITHUB_REPOSITORY_OWNER: context.repository.owner,
        GITHUB_RUN_ID: context.runId,
      };

      const result = await main({
        inputs,
        env: testEnv as Record<string, string>,
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
  .argument("[file]", "Fixture file to use (.txt, .json, or .ts)", "fixtures/basic.txt")
  .option("--act", "Use Docker/act to run the action instead of running directly")
  .action(async (file: string, options: { act?: boolean }) => {
    await runPlay(file, options);
  });

// Parse arguments and run
program.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
