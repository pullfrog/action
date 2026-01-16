import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromHere } from "@ark/fs";
import arg from "arg";
import { config } from "dotenv";
import type { AgentResult } from "./agents/shared.ts";
import { type Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";
import { setupTestRepo } from "./utils/setup.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// load action's .env file in case it exists for local dev
config();
// also load .env from repo root (for monorepo structure)
config({ path: join(__dirname, "..", ".env") });

export async function run(inputsOrPrompt: Inputs | string): Promise<AgentResult> {
  // create unique temp directory path in OS temp location for parallel execution
  // use a parent dir from mkdtemp, then clone into a 'repo' subdirectory
  const tempParent = await mkdtemp(join(tmpdir(), "pullfrog-play-"));
  const tempDir = join(tempParent, "repo");
  const originalCwd = process.cwd();

  try {
    setupTestRepo({ tempDir });
    process.chdir(tempDir);

    // allow passing full Inputs object or just a prompt string
    const inputs: Inputs =
      typeof inputsOrPrompt === "string" ? { prompt: inputsOrPrompt } : inputsOrPrompt;

    // Mock core.getInput to simulate Github Actions input
    const mockCore = {
      getInput: (name: string, options?: { required?: boolean }): string => {
        const value = inputs[name as keyof Inputs];
        if (value === undefined || value === null) {
          if (options?.required) {
            throw new Error(`Input required and not supplied: ${name}`);
          }
          return "";
        }
        return String(value);
      },
    };

    const result = await main(mockCore);

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
  } finally {
    // cleanup temp directory
    process.chdir(originalCwd);
    rmSync(tempParent, { recursive: true, force: true });
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
  --local, -l             Run locally (default: runs in Docker)
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

    const passArgs = process.argv
      .slice(2)
      // shell-escape each argument to handle special characters in JSON payloads
      .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(" ");
    const nodeCmd = `node play.ts ${passArgs}`;

    // pass all env vars to docker
    const envFlags = Object.entries(process.env).flatMap(([key, value]) =>
      value !== undefined ? ["-e", `${key}=${value}`] : []
    );

    // SSH for git - platform-specific handling
    const sshFlags: string[] = [];
    let sshSetupCmd = "";
    const plat = platform();
    const home = process.env.HOME;

    if (plat === "win32") {
      throw new Error(
        "Docker mode is not supported on native Windows. Use WSL2 or set PLAY_LOCAL=1."
      );
    } else if (plat === "darwin") {
      // macOS: Docker Desktop SSH agent forwarding
      if (home) {
        const knownHostsPath = join(home, ".ssh", "known_hosts");
        if (existsSync(knownHostsPath)) {
          sshFlags.push("-v", `${knownHostsPath}:/root/.ssh/known_hosts:ro`);
        }
      }
      sshFlags.push(
        "-v",
        "/run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock",
        "-e",
        "SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock"
      );
    } else {
      // Linux/WSL: copy .ssh files into container with correct permissions
      if (home) {
        const sshDir = join(home, ".ssh");
        if (existsSync(sshDir)) {
          sshFlags.push("-v", `${sshDir}:/tmp/.ssh-host:ro`);
          // copy ssh keys, add github.com to known_hosts, set GIT_SSH_COMMAND to use them
          sshSetupCmd =
            "mkdir -p /tmp/home/.ssh && cp /tmp/.ssh-host/id_* /tmp/home/.ssh/ 2>/dev/null; chmod 600 /tmp/home/.ssh/id_* 2>/dev/null; " +
            "ssh-keyscan -t ed25519,rsa github.com >> /tmp/home/.ssh/known_hosts 2>/dev/null; chmod 644 /tmp/home/.ssh/known_hosts; " +
            "export GIT_SSH_COMMAND='ssh -i /tmp/home/.ssh/id_rsa -o UserKnownHostsFile=/tmp/home/.ssh/known_hosts -o StrictHostKeyChecking=no'; ";
        }
      }
    }

    // always allocate a pseudo-TTY - Claude Code may require it
    const ttyFlags = ["-t"];

    // run as current user to avoid Claude CLI's root user restriction
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;

    // use agent-specific volume to avoid conflicts when running in parallel
    const agentOverride = process.env.AGENT_OVERRIDE ?? "default";
    const volumeName = `pullfrog-action-node-modules-${agentOverride}`;

    // initialize volume with correct ownership (runs as root briefly)
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/app/action/node_modules`,
        "node:24",
        "chown",
        "-R",
        `${uid}:${gid}`,
        "/app/action/node_modules",
      ],
      { stdio: "ignore", cwd: __dirname }
    );

    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        ...ttyFlags,
        "--user",
        `${uid}:${gid}`,
        "-v",
        `${__dirname}:/app/action:cached`,
        "-v",
        `${volumeName}:/app/action/node_modules`,
        "-w",
        "/app/action",
        ...envFlags,
        ...sshFlags,
        "-e",
        "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
        "-e",
        `HOME=/tmp/home`,
        "node:24",
        "bash",
        "-c",
        `${sshSetupCmd}mkdir -p /tmp/home/.config /tmp/home/.cache && corepack pnpm install --frozen-lockfile --ignore-scripts && ${nodeCmd}`,
      ],
      { stdio: "inherit", cwd: __dirname }
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

    const fixturesPath = fromHere("test", "fixtures", filePath);
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
        } else if (Array.isArray(module.default)) {
          // Array of Payloads - run each in sequence
          const payloads = module.default;
          log.info(`Running ${payloads.length} payloads in sequence...`);

          let allSuccess = true;
          for (let i = 0; i < payloads.length; i++) {
            const payload = payloads[i];
            const label = payload.effort
              ? `[${i + 1}/${payloads.length}] effort=${payload.effort}`
              : `[${i + 1}/${payloads.length}]`;
            log.info(`\n${"=".repeat(60)}`);
            log.info(`${label}`);
            log.info(`${"=".repeat(60)}\n`);

            const payloadPrompt = JSON.stringify(payload, null, 2);
            const result = await run(payloadPrompt);
            if (!result.success) {
              allSuccess = false;
              log.error(`Payload ${i + 1} failed`);
            }
          }

          process.exit(allSuccess ? 0 : 1);
        } else if (typeof module.default === "object") {
          const obj = module.default as Record<string, unknown>;
          // Inputs objects have `prompt` field and optional tool permission fields
          // Payload objects have `~pullfrog` field
          if ("prompt" in obj && !("~pullfrog" in obj)) {
            // this is an Inputs object - run directly with tool permissions
            const result = await run(obj as Inputs);
            process.exit(result.success ? 0 : 1);
          }
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
