import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fromHere } from "@ark/fs";
import { flatMorph } from "@ark/util";
import arg from "arg";
import { config } from "dotenv";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import { type Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";
import { setupTestRepo } from "./utils/setup.ts";

// load action's .env file in case it exists for local dev
config();
// .env file should always be at repo root for pullfrog/pullfrog repo with action submodule
config({ path: join(process.cwd(), "..", ".env") });

export async function run(prompt: string): Promise<AgentResult> {
  try {
    const tempDir = join(process.cwd(), ".temp");
    setupTestRepo({ tempDir });

    const originalCwd = process.cwd();
    process.chdir(tempDir);

    // check if prompt is a pullfrog payload and extract agent
    // note: agent from payload will be used by determineAgent with highest precedence
    // we don't need to extract it here since main() will parse the payload
    const inputs = {
      prompt,
      ...flatMorph(agents, (_, agent) => {
        // for OpenCode, scan all API_KEY environment variables
        if (agent.name === "opencode") {
          const opencodeKeys: Array<[string, string | undefined]> = [];
          for (const [key, value] of Object.entries(process.env)) {
            if (value && typeof value === "string" && key.includes("API_KEY")) {
              opencodeKeys.push([key.toLowerCase(), value]);
            }
          }
          return opencodeKeys;
        }
        // for other agents, use apiKeyNames
        return agent.apiKeyNames.map((inputKey) => [inputKey, process.env[inputKey.toUpperCase()]]);
      }),
    } as Required<Inputs>;

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
    "--local": Boolean,
    "-h": "--help",
    "-l": "--local",
  });

  if (args["--help"]) {
    log.info(`
Usage: tsx play.ts [file] [options]

Test the Pullfrog action with various prompts.

Arguments:
  file                    Prompt file to use (.txt, .json, or .ts) [default: fixtures/basic.txt]

Options:
  --raw [prompt]          Use raw string as prompt instead of loading from file
  --local, -l             Run locally on macOS (default: runs in Docker)
  -h, --help              Show this help message

Environment:
  PLAY_LOCAL=1            Same as --local

Examples:
  tsx play.ts bash-test.ts           # Run in Docker (default)
  tsx play.ts --local bash-test.ts   # Run locally on macOS
  tsx play.ts --raw "Hello world"    # Use raw string as prompt
    `);
    process.exit(0);
  }

  // default: run in Docker (unless --local or PLAY_LOCAL=1 or already inside Docker)
  const isInsideDocker = existsSync("/.dockerenv");
  const useLocal = args["--local"] || process.env.PLAY_LOCAL === "1" || isInsideDocker;

  if (!useLocal) {
    log.info("» running in Docker container...");

    const passArgs = process.argv.slice(2);
    const nodeCmd = `node play.ts ${passArgs.join(" ")}`;

    // pass .env file directly to Docker
    const envFile = join(process.cwd(), "..", ".env");
    const envFlags = existsSync(envFile) ? ["--env-file", envFile] : [];

    // SSH agent forwarding for git (macOS Docker Desktop magic path)
    const sshFlags: string[] = [];
    if (process.env.SSH_AUTH_SOCK) {
      sshFlags.push(
        "-v",
        "/run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock",
        "-e",
        "SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock"
      );
    }
    const home = process.env.HOME;
    if (home && existsSync(join(home, ".ssh", "known_hosts"))) {
      sshFlags.push("-v", `${home}/.ssh/known_hosts:/root/.ssh/known_hosts:ro`);
    }

    const ttyFlags = process.stdin.isTTY ? ["-it"] : [];

    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        ...ttyFlags,
        "-v",
        `${process.cwd()}:/app/action:cached`,
        "-v",
        "pullfrog-action-node-modules:/app/action/node_modules",
        "-w",
        "/app/action",
        "-e",
        "GITHUB_ACTIONS=true",
        "-e",
        "CI=true",
        ...envFlags,
        ...sshFlags,
        "--cap-add",
        "SYS_ADMIN",
        "--security-opt",
        "seccomp:unconfined",
        "node:22",
        "bash",
        "-c",
        `corepack enable pnpm >/dev/null 2>&1 && pnpm install --frozen-lockfile && ${nodeCmd}`,
      ],
      { stdio: "inherit" }
    );

    process.exit(result.status ?? 1);
  }

  let prompt: string;

  if (args["--raw"]) {
    prompt = args["--raw"];
  } else {
    const filePath = args._[0] || "basic.txt";

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
        } else if (typeof module.default === "object") {
          // Payload objects (with ~pullfrog) should be stringified
          prompt = JSON.stringify(module.default, null, 2);
        } else {
          throw new Error(`Unsupported default export type: ${typeof module.default}`);
        }
        break;
      }

      default:
        throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .json, .ts`);
    }
  }

  try {
    const result = await run(prompt);

    if (!result.success) {
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
