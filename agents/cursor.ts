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
      const fullPrompt = addInstructions(payload);

      log.info("Running Cursor CLI...");

      const startTime = Date.now();

      return new Promise((resolve) => {
        const child = spawn(
          cliPath,
          [
            "--print",
            fullPrompt,
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--approve-mcps",
            "--force",
          ],
          {
            cwd: process.cwd(),
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
        let jsonBuffer = "";

        child.on("spawn", () => {
          log.debug("Cursor CLI process spawned");
        });

        child.stdout?.on("data", async (data) => {
          const text = data.toString();
          stdout += text;
          jsonBuffer += text;

          // parse ndjson (newline-delimited json)
          const lines = jsonBuffer.split("\n");
          // keep last incomplete line in buffer
          jsonBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              const event = JSON.parse(trimmedLine);
              // log everything for now - we'll infer types from real output
              log.debug(`[cursor event] ${JSON.stringify(event, null, 2)}`);
            } catch {
              // if json parse fails, might be partial line or non-json output
              // log debug info but don't crash
              log.debug(`failed to parse json line: ${trimmedLine.substring(0, 100)}`);
            }
          }
        });

        child.stderr?.on("data", (data) => {
          const text = data.toString();
          stderr += text;
          process.stderr.write(text);
          log.warning(text);
        });

        child.on("close", async (code, signal) => {
          // process any remaining buffered json
          if (jsonBuffer.trim()) {
            try {
              const event = JSON.parse(jsonBuffer.trim());
              log.debug(`[cursor event] ${JSON.stringify(event, null, 2)}`);
            } catch {
              // ignore parse errors for final buffer
            }
          }

          if (signal) {
            log.warning(`Cursor CLI terminated by signal: ${signal}`);
          }

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);

          if (code === 0) {
            log.success(`Cursor CLI completed successfully in ${duration}s`);
            resolve({
              success: true,
              output: stdout.trim(),
            });
          } else {
            const errorMessage = stderr || `Cursor CLI exited with code ${code}`;
            log.error(`Cursor CLI failed after ${duration}s: ${errorMessage}`);
            resolve({
              success: false,
              error: errorMessage,
              output: stdout.trim(),
            });
          }
        });

        child.on("error", (error) => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const errorMessage = error.message || String(error);
          log.error(`Cursor CLI execution failed after ${duration}s: ${errorMessage}`);
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
