import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromCurl } from "./shared.ts";

export const cursor = agent({
  name: "cursor",
  inputKeys: ["cursor_api_key"],
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
      const fullPrompt = addInstructions(payload);

      const tempDir = cliPath.split("/.local/bin/")[0];

      log.info("Running Cursor CLI...");

      return new Promise((resolve) => {
        const child = spawn(
          cliPath,
          ["--print", fullPrompt, "--output-format", "text", "--approve-mcps", "--force"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CURSOR_API_KEY: apiKey,
              GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
              HOME: tempDir, // Set HOME so Cursor CLI can find .cursor/mcp.json
            },
            stdio: ["ignore", "pipe", "pipe"], // Ignore stdin, pipe stdout/stderr
          }
        );

        let stdout = "";
        let stderr = "";

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
          process.stderr.write(text);
          log.warning(text);
        });

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

/**
 * Configure MCP servers for Cursor by writing to the Cursor configuration file.
 * For cursor, we need to add the MCP servers to the Cursor configuration file manually as there is no CLI command to do this.
 */
function configureCursorMcpServers({ mcpServers, cliPath }: ConfigureMcpServersParams) {
  const tempDir = cliPath.split("/.local/bin/")[0];
  const cursorConfigDir = join(tempDir, ".cursor");
  const mcpConfigPath = join(cursorConfigDir, "mcp.json");
  mkdirSync(cursorConfigDir, { recursive: true });
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2), "utf-8");
}
