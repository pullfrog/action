import { spawnSync } from "node:child_process";

import { findCliPath, log } from "../utils/cli.ts";
import { type Agent, instructions } from "./shared.ts";

export const codex: Agent = {
  install: async (): Promise<string> => {
    const globalCodexPath = findCliPath("codex");
    if (globalCodexPath) {
      log.info(`Using global Codex CLI at ${globalCodexPath}`);
      return globalCodexPath;
    }

    // Install Codex CLI globally using npm
    log.info(`📦 Installing Codex CLI globally with npm...`);
    try {
      const installResult = spawnSync("npm", ["install", "-g", "codex"], {
        stdio: "inherit",
        encoding: "utf-8",
      });

      if (installResult.status !== 0) {
        throw new Error(`npm install failed with status ${installResult.status}`);
      }

      // Verify installation
      const installedPath = findCliPath("codex");
      if (installedPath) {
        log.info(`✓ Codex CLI installed at ${installedPath}`);
        return installedPath;
      }

      throw new Error("Codex CLI installation completed but executable not found");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to install Codex CLI: ${errorMessage}`);
      throw new Error(`Codex CLI installation failed: ${errorMessage}`);
    }
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath }) => {
    process.env.OPENAI_API_KEY = apiKey;

    // Configure MCP servers for Codex (global config is fine - not part of repo)
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      log.info("Configuring MCP servers for Codex...");
      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        try {
          // Only configure stdio servers (Codex CLI supports stdio MCP servers)
          // Check if it's a stdio server config (has 'command' property)
          if (!("command" in serverConfig)) {
            log.warning(`MCP server '${serverName}' is not a stdio server, skipping...`);
            continue;
          }

          // Build command and args
          const command = serverConfig.command;
          const args = serverConfig.args || [];
          const envVars = serverConfig.env || {};

          // Build the codex mcp add command with proper argument handling
          const addArgs = ["mcp", "add", serverName, "--", command, ...args];

          // Add environment variables as --env flags
          for (const [key, value] of Object.entries(envVars)) {
            addArgs.push("--env", `${key}=${value}`);
          }

          log.info(`Adding MCP server '${serverName}'...`);
          const addResult = spawnSync(cliPath, addArgs, {
            stdio: "inherit",
            encoding: "utf-8",
            env: {
              ...process.env,
              OPENAI_API_KEY: apiKey,
            },
          });

          if (addResult.status !== 0) {
            throw new Error(
              `codex mcp add failed: ${addResult.stderr || addResult.stdout || "Unknown error"}`
            );
          }
          log.info(`✓ MCP server '${serverName}' configured`);
        } catch (error) {
          log.warning(
            `Failed to configure MCP server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with other servers
        }
      }
    }

    // Use codex exec command via CLI
    const fullPrompt = `${instructions}\n\n****** USER PROMPT ******\n${prompt}`;

    log.info("Running Codex via CLI...");

    try {
      // Execute codex via CLI using child_process
      const result = spawnSync("codex", ["exec", fullPrompt], {
        encoding: "utf-8",
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKey,
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (result.status !== 0) {
        const errorMessage = result.stderr || result.stdout || "Codex execution failed";
        log.error(`Codex execution failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          output: result.stdout || "",
        };
      }

      const output = result.stdout || "";
      log.box(output, { title: "Codex" });

      return {
        success: true,
        output,
      };
    } catch (cliError) {
      const errorMessage = cliError instanceof Error ? cliError.message : String(cliError);
      log.error(`Codex execution failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: "",
      };
    }
  },
};
