import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fromHere } from "@ark/fs";
import arg from "arg";
import { config } from "dotenv";
import { type Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";
import { setupTestRepo } from "./utils/setup.ts";

config();

export async function run(
  prompt: string
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  try {
    const tempDir = join(process.cwd(), ".temp");
    setupTestRepo({ tempDir, forceClean: true });

    const originalCwd = process.cwd();
    process.chdir(tempDir);

    log.info("🚀 Running action with prompt...");
    log.separator();
    log.box(prompt, { title: "Prompt" });
    log.separator();

    const inputs: Inputs = {
      prompt,
      openai_api_key: process.env.OPENAI_API_KEY,
      anthropic_api_key: process.env.ANTHROPIC_API_KEY,
      agent: "codex",
    };

    const result = await main(inputs);

    process.chdir(originalCwd);

    if (result.success) {
      log.success("Action completed successfully");
      return { success: true, output: result.output || undefined, error: undefined };
    } else {
      log.error(`Action failed: ${result.error || "Unknown error"}`);
      return { success: false, error: result.error || undefined, output: undefined };
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    log.error(`Error: ${errorMessage}`);
    return { success: false, error: errorMessage, output: undefined };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = arg({
    "--help": Boolean,
    "--raw": String,
    "-h": "--help",
  });

  if (args["--help"]) {
    log.info(`
Usage: tsx play.ts [file] [options]

Test the Pullfrog action with various prompts.

Arguments:
  file                    Prompt file to use (.txt, .json, or .ts) [default: fixtures/basic.txt]

Options:
  --raw [prompt]          Use raw string as prompt instead of loading from file
  -h, --help              Show this help message

Examples:
  tsx play.ts                        # Use default fixture
  tsx play.ts fixtures/basic.txt     # Use specific text file
  tsx play.ts custom.json            # Use JSON file
  tsx play.ts fixtures/test.ts       # Use TypeScript file
  tsx play.ts --raw "Hello world"    # Use raw string as prompt
    `);
    process.exit(0);
  }

  let prompt: string;

  if (args["--raw"]) {
    prompt = args["--raw"];
  } else {
    // Default to testing tool calls if no file specified
    const filePath = args._[0] || null;
    if (!filePath) {
      prompt =
        "List all available MCP tools from the gh-pullfrog server and show what each tool does.";
    } else {
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
  }

  try {
    const result = await run(prompt);

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
