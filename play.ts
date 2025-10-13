import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fromHere } from "@ark/fs";
import arg from "arg";
import { config } from "dotenv";
import { type ActionInputs, main } from "./main.ts";
import packageJson from "./package.json" with { type: "json" };
import { runAct } from "./utils/act.ts";
import { setupGitHubInstallationToken } from "./utils/github.ts";
import { setupTestRepo } from "./utils/setup.ts";

config();

export async function run(
  prompt: string,
  options: { act?: boolean } = {}
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  try {
    console.log(`🐸 Running pullfrog/action@${packageJson.version}...`);
    if (options.act) {
      console.log("🐳 Running with Docker/act...");
      runAct(prompt);
      return { success: true };
    }

    const tempDir = join(process.cwd(), ".temp");
    setupTestRepo({ tempDir, forceClean: true });

    const originalCwd = process.cwd();
    process.chdir(tempDir);

    console.log("🚀 Running action with prompt...");
    console.log("─".repeat(50));
    console.log("Prompt:");
    console.log(prompt);
    console.log("─".repeat(50));

    console.log("🔑 Setting up GitHub installation token...");
    const installationToken = await setupGitHubInstallationToken();
    process.env.GITHUB_INSTALLATION_TOKEN = installationToken;

    console.log("✅ GitHub installation token setup successfully");

    const inputs: ActionInputs = {
      prompt,
      anthropic_api_key: process.env.ANTHROPIC_API_KEY,
      github_installation_token: installationToken,
    };

    const result = await main(inputs);

    process.chdir(originalCwd);

    if (result.success) {
      console.log("✅ Action completed successfully");
      if (result.output) {
        console.log("Output:", result.output);
      }
      return { success: true, output: result.output || undefined, error: undefined };
    } else {
      console.error("❌ Action failed:", result.error);
      return { success: false, error: result.error || undefined, output: undefined };
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error("❌ Error:", errorMessage);
    return { success: false, error: errorMessage, output: undefined };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = arg({
    "--help": Boolean,
    "--act": Boolean,
    "--raw": String,
    "-h": "--help",
  });

  if (args["--help"]) {
    console.log(`
Usage: tsx play.ts [file] [options]

Test the Pullfrog action with various prompts.

Arguments:
  file                    Prompt file to use (.txt, .json, or .ts) [default: fixtures/basic.txt]

Options:
  --act                   Use Docker/act to run the action instead of running directly
  --raw [prompt]          Use raw string as prompt instead of loading from file
  -h, --help              Show this help message

Examples:
  tsx play.ts                        # Use default fixture
  tsx play.ts fixtures/basic.txt     # Use specific text file
  tsx play.ts custom.json            # Use JSON file
  tsx play.ts --act fixtures/test.ts # Use TypeScript file with Docker/act
  tsx play.ts --raw "Hello world"    # Use raw string as prompt
    `);
    process.exit(0);
  }

  let prompt: string;

  if (args["--raw"]) {
    prompt = args["--raw"];
  } else {
    const filePath = args._[0] || "fixtures/basic.txt";
    const ext = extname(filePath).toLowerCase();
    let resolvedPath: string;

    const fixturesPath = fromHere("fixtures", filePath);
    if (existsSync(fixturesPath)) {
      resolvedPath = fixturesPath;
    } else if (existsSync(filePath)) {
      resolvedPath = resolve(filePath);
    } else {
      throw new Error(`File not found: ${filePath}`);
    }

    switch (ext) {
      case ".txt": {
        prompt = readFileSync(resolvedPath, "utf8").trim();
        break;
      }

      case ".json": {
        const content = readFileSync(resolvedPath, "utf8");
        const parsed = JSON.parse(content);
        prompt = JSON.stringify(parsed, null, 2);
        break;
      }

      case ".ts": {
        const fileUrl = pathToFileURL(resolvedPath).href;
        const module = await import(fileUrl);

        if (!module.default) {
          throw new Error(`TypeScript file ${filePath} must have a default export`);
        }

        if (typeof module.default === "string") {
          prompt = module.default;
        } else if (typeof module.default === "object" && module.default.prompt) {
          prompt = module.default.prompt;
        } else {
          prompt = JSON.stringify(module.default, null, 2);
        }
        break;
      }

      default:
        throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .json, .ts`);
    }
  }

  try {
    const result = await run(prompt, { act: args["--act"] || false });

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
    process.exit(1);
  }
}
