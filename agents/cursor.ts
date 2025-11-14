import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, installFromCurl } from "./shared.ts";

export const cursor = agent({
  name: "cursor",
  inputKey: "cursor_api_key",
  install: async () => {
    return await installFromCurl({
      installUrl: "https://cursor.com/install",
      executableName: "cursor-agent",
    });
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath, githubInstallationToken }) => {
    process.env.CURSOR_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    // Configure MCP servers for Cursor (global config is fine - not part of repo)
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      configureMcpServers({ mcpServers, cliPath });
    }

    try {
      // Run cursor-agent in non-interactive mode with the prompt
      // Using -p flag for prompt, --output-format text for plain text output
      // and --approve-mcps to automatically approve all MCP servers
      const fullPrompt = addInstructions(prompt);

      // Find temp directory from cliPath to set HOME for MCP config lookup
      const tempDir = cliPath.split("/.local/bin/")[0];

      log.info("Running Cursor CLI...");

      // Use spawn to handle streaming output
      // Use --print flag explicitly for non-interactive mode
      return new Promise((resolve) => {
        const child = spawn(
          cliPath,
          ["--print", fullPrompt, "--output-format", "text", "--approve-mcps"],
          {
            cwd: process.cwd(), // Run in current working directory
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
        let hasOutput = false;

        // Set a timeout to detect if the process hangs
        const timeout = setTimeout(() => {
          if (!hasOutput && child.exitCode === null) {
            log.warning("Cursor CLI appears to be hanging, killing process...");
            child.kill("SIGTERM");
            resolve({
              success: false,
              error: "Cursor CLI timed out - no output received",
              output: stdout.trim(),
            });
          }
        }, 300000); // 5 minute timeout

        // Log when process starts
        child.on("spawn", () => {
          log.debug("Cursor CLI process spawned");
        });

        child.stdout?.on("data", (data) => {
          hasOutput = true;
          const text = data.toString();
          stdout += text;
          // Stream output in real-time
          process.stdout.write(text);
        });

        child.stderr?.on("data", (data) => {
          hasOutput = true;
          const text = data.toString();
          stderr += text;
          // Log errors as they come - but also write to stdout so we can see it
          process.stderr.write(text);
          log.warning(text);
        });

        // Handle process exit
        child.on("close", (code) => {
          clearTimeout(timeout);

          if (code !== 0) {
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

function configureMcpServers({
  mcpServers,
  cliPath,
}: {
  mcpServers: Record<string, McpServerConfig>;
  cliPath: string;
}): void {
  log.info("Configuring MCP servers for Cursor...");

  const tempDir = cliPath.split("/.local/bin/")[0];
  const cursorConfigDir = join(tempDir, ".cursor");
  const mcpConfigPath = join(cursorConfigDir, "mcp.json");

  // Build MCP configuration object
  const mcpConfig: { mcpServers: Record<string, McpServerConfig> } = {
    mcpServers: {},
  };

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    // Only configure stdio servers (Cursor CLI supports stdio MCP servers)
    // Check if it's a stdio server config (has 'command' property)
    if (!("command" in serverConfig)) {
      log.warning(`MCP server '${serverName}' is not a stdio server, skipping...`);
      continue;
    }

    // Add the server configuration
    mcpConfig.mcpServers[serverName] = serverConfig;
    log.info(`Adding MCP server '${serverName}'...`);
  }

  if (Object.keys(mcpConfig.mcpServers).length === 0) {
    log.info("No MCP servers to configure");
    return;
  }

  // Create .cursor directory if it doesn't exist
  mkdirSync(cursorConfigDir, { recursive: true });

  // Write MCP configuration file
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
  log.info(`✓ MCP configuration written to ${mcpConfigPath}`);

  // Cursor CLI may require approval for MCP servers
  // Use --approve-mcps flag when running to automatically approve all MCP servers
  log.info("MCP servers configured. Cursor CLI will use --approve-mcps to auto-approve servers.");
}
