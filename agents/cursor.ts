import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromCurl } from "./shared.ts";

export const cursor = agent({
  name: "cursor",
  install: async () => {
    return await installFromCurl({
      installUrl: "https://cursor.com/install",
      executableName: "cursor-agent",
    });
  },
  run: async ({ payload, apiKey, cliPath, githubInstallationToken, mcpServers }) => {
    process.env.CURSOR_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    configureCursorMcpServers({ mcpServers, cliPath });

    try {
      // Run cursor-agent in non-interactive mode with the prompt
      // Using -p flag for prompt, --output-format text for plain text output
      // and --approve-mcps to automatically approve all MCP servers
      const fullPrompt = addInstructions(payload);

      log.info("Running Cursor CLI...");

      // Use spawn to handle streaming output
      // Use --print flag explicitly for non-interactive mode
      return new Promise((resolve) => {
        const child = spawn(
          cliPath,
          ["--print", fullPrompt, "--output-format", "text", "--approve-mcps", "--force"],
          {
            cwd: process.cwd(), // Run in current working directory
            env: {
              ...process.env,
              CURSOR_API_KEY: apiKey,
              GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
              // Don't override HOME - Cursor CLI needs access to macOS keychain
              // MCP config is written to tempDir/.cursor/mcp.json which Cursor will find
            },
            stdio: ["ignore", "pipe", "pipe"], // Ignore stdin, pipe stdout/stderr
          }
        );

        let stdout = "";
        let stderr = "";

        // Log when process starts
        child.on("spawn", () => {
          log.debug("Cursor CLI process spawned");
        });

        child.stdout?.on("data", (data) => {
          const text = data.toString();
          stdout += text;
          // Stream output in real-time
          process.stdout.write(text);
        });

        child.stderr?.on("data", (data) => {
          const text = data.toString();
          stderr += text;
          // Log errors as they come - but also write to stdout so we can see it
          process.stderr.write(text);
          log.warning(text);
        });

        // Handle process exit
        child.on("close", (code, signal) => {
          if (signal) {
            log.warning(`Cursor CLI terminated by signal: ${signal}`);
          }

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

// There was an issue on macOS when you set HOME to a temp directory
// it was unable to find the macOS keychain and would fail
// temp solution is to stick with the actual $HOME
function configureCursorMcpServers({ mcpServers }: ConfigureMcpServersParams) {
  const realHome = homedir();
  const cursorConfigDir = join(realHome, ".cursor");
  const mcpConfigPath = join(cursorConfigDir, "mcp.json");
  mkdirSync(cursorConfigDir, { recursive: true });
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2), "utf-8");
  log.info(`MCP config written to ${mcpConfigPath}`);
}
