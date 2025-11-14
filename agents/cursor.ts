import { spawnSync, spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent } from "./shared.ts";

/**
 * Install Cursor CLI to a temporary directory
 * Downloads the install script and runs it with PREFIX set to temp directory
 * Falls back to checking system PATH if installation fails
 */
async function installCursorCli(): Promise<string> {
  log.info("📦 Installing Cursor CLI...");

  // Create temp directory
  const tempDir = await mkdtemp(join(tmpdir(), "cursor-cli-"));
  const installScriptPath = join(tempDir, "install.sh");
  const binDir = join(tempDir, "bin");

  // Download the install script
  log.info("Downloading Cursor CLI install script...");
  const installScriptResponse = await fetch("https://cursor.com/install");
  if (!installScriptResponse.ok) {
    throw new Error(`Failed to download install script: ${installScriptResponse.status}`);
  }

  if (!installScriptResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(installScriptPath);
  await pipeline(installScriptResponse.body, fileStream);

  // Make install script executable
  chmodSync(installScriptPath, 0o755);

  log.info("Installing Cursor CLI to temp directory...");

  // Try to run the install script with PREFIX set to temp directory
  // Many install scripts respect PREFIX or INSTALL_PREFIX environment variables
  const installResult = spawnSync("bash", [installScriptPath], {
    cwd: tempDir,
    env: {
      ...process.env,
      PREFIX: tempDir,
      INSTALL_PREFIX: tempDir,
      DESTDIR: tempDir,
      HOME: tempDir, // Some scripts use HOME for user-specific installs
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  // Check common installation locations
  const possiblePaths = [
    join(binDir, "cursor-agent"),
    join(tempDir, "cursor-agent"),
    join(tempDir, ".local", "bin", "cursor-agent"),
    join(tempDir, ".cursor", "bin", "cursor-agent"),
  ];

  let cliPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      cliPath = path;
      break;
    }
  }

  // If not found, check if cursor-agent is already in PATH (fallback)
  if (!cliPath) {
    const whichResult = spawnSync("which", ["cursor-agent"], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (whichResult.status === 0 && whichResult.stdout) {
      cliPath = whichResult.stdout.trim();
      log.info(`Using system cursor-agent at ${cliPath}`);
    }
  }

  if (!cliPath || !existsSync(cliPath)) {
    // Provide helpful error message
    const errorOutput = installResult.stderr || installResult.stdout || "No output";
    throw new Error(
      `Failed to install Cursor CLI. Install script exited with code ${installResult.status}. Output: ${errorOutput}`
    );
  }

  // Ensure binary is executable
  chmodSync(cliPath, 0o755);
  log.info(`✓ Cursor CLI installed at ${cliPath}`);
  return cliPath;
}

export const cursor = agent({
  name: "cursor",
  inputKey: "cursor_api_key",
  install: installCursorCli,
  run: async ({ prompt, mcpServers, apiKey, cliPath, githubInstallationToken }) => {
    process.env.CURSOR_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    // TODO: Configure MCP servers for Cursor if supported
    // Cursor CLI may support MCP configuration similar to Codex
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      log.info("MCP server configuration for Cursor CLI is not yet implemented");
    }

    try {
      // Run cursor-agent in non-interactive mode with the prompt
      // Using -p flag for prompt and --output-format text for plain text output
      const fullPrompt = addInstructions(prompt);

      log.info("Running Cursor CLI...");

      // Use spawn to handle streaming output
      return new Promise((resolve) => {
        const child = spawn(cliPath, ["-p", fullPrompt, "--output-format", "text"], {
          env: {
            ...process.env,
            CURSOR_API_KEY: apiKey,
            GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data) => {
          const text = data.toString();
          stdout += text;
          // Stream output in real-time
          process.stdout.write(text);
        });

        child.stderr?.on("data", (data) => {
          const text = data.toString();
          stderr += text;
          // Log errors as they come
          log.warning(text);
        });

        child.on("close", (code) => {
          if (code === 0) {
            log.success("Cursor CLI completed successfully");
            resolve({
              success: true,
              output: stdout.trim(),
            });
          } else {
            const errorMessage = stderr || `Cursor CLI exited with code ${code}`;
            log.error(`Cursor CLI failed: ${errorMessage}`);
            resolve({
              success: false,
              error: errorMessage,
              output: stdout.trim(),
            });
          }
        });

        child.on("error", (error) => {
          const errorMessage = error.message || String(error);
          log.error(`Cursor CLI execution failed: ${errorMessage}`);
          resolve({
            success: false,
            error: errorMessage,
            output: stdout.trim(),
          });
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Cursor execution failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: "",
      };
    }
  },
});
