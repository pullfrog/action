import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, installFromCurl, type AddMcpServerParams } from "./shared.ts";

export const cursor = agent({
  name: "cursor",
  inputKeys: ["cursor_api_key"],
  install: async () => {
    return await installFromCurl({
      installUrl: "https://cursor.com/install",
      executableName: "cursor-agent",
    });
  },
  addMcpServer: ({ serverName, serverConfig, cliPath }: AddMcpServerParams) => {
    const command = serverConfig.command;
    const args = serverConfig.args || [];
    const envVars = serverConfig.env || {};

    // Resolve command to absolute path if it's a relative path
    // For commands like "node", keep as-is; for file paths, resolve them
    let resolvedCommand = command;
    if (!command.includes("/") && !command.includes("\\")) {
      // It's a command in PATH (like "node"), keep as-is
      resolvedCommand = command;
    } else {
      // It's a file path, resolve to absolute path
      resolvedCommand = resolve(command);
    }

    // Resolve args to absolute paths if they look like file paths
    const resolvedArgs = args.map((arg) => {
      // If arg looks like a file path and is relative, resolve it
      if (
        (arg.includes("/") || arg.includes("\\")) &&
        !arg.startsWith("/") &&
        !arg.match(/^[A-Z]:\\/)
      ) {
        return resolve(arg);
      }
      return arg;
    });

    // Build the server config with resolved paths
    const resolvedServerConfig = {
      command: resolvedCommand,
      args: resolvedArgs,
      env: envVars,
    };

    const tempDir = cliPath.split("/.local/bin/")[0];
    const cursorConfigDir = join(tempDir, ".cursor");
    const mcpConfigPath = join(cursorConfigDir, "mcp.json");

    // Read existing config if it exists
    let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
    if (existsSync(mcpConfigPath)) {
      try {
        const existingConfig = readFileSync(mcpConfigPath, "utf-8");
        mcpConfig = JSON.parse(existingConfig);
        if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
          mcpConfig.mcpServers = {};
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read existing MCP config at ${mcpConfigPath}: ${errorMessage}`);
      }
    }

    // Add the new server
    mcpConfig.mcpServers[serverName] = resolvedServerConfig;
    log.info(`Adding MCP server '${serverName}' to Cursor configuration...`);

    // Create .cursor directory if it doesn't exist
    try {
      mkdirSync(cursorConfigDir, { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to create Cursor config directory at ${cursorConfigDir}: ${errorMessage}`
      );
    }

    // Write MCP configuration file
    try {
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
      log.info(`✓ MCP server '${serverName}' added to ${mcpConfigPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write MCP config to ${mcpConfigPath}: ${errorMessage}`);
    }
  },
  run: async ({ prompt, apiKey, cliPath, githubInstallationToken }) => {
    process.env.CURSOR_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

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
          ["--print", fullPrompt, "--output-format", "text", "--approve-mcps", "--force"],
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
