import { spawnSync } from "node:child_process";

import { log } from "../utils/cli.ts";
import { addInstructions } from "./instructions.ts";
import { agent, installFromNpmTarball } from "./shared.ts";

export const codex = agent({
  name: "codex",
  inputKey: "openai_api_key",
  install: async () => {
    return await installFromNpmTarball({
      packageName: "@openai/codex",
      version: "latest",
      executablePath: "bin/codex.js",
    });
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath }) => {
    // Equivalent to: printenv OPENAI_API_KEY | codex login --with-api-key
    // see: https://github.com/openai/codex/blob/main/docs/authentication.md#usage-based-billing-alternative-use-an-openai-api-key
    const loginResult = spawnSync("node", [cliPath, "login", "--with-api-key"], {
      input: apiKey,
      encoding: "utf-8",
    });

    if (loginResult.status !== 0) {
      throw new Error(
        `codex login failed: ${loginResult.stderr || loginResult.stdout || "Unknown error"}`
      );
    }

    // Configure MCP servers for Codex (global config is fine - not part of repo)
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      log.info("Configuring MCP servers for Codex...");
      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
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
        const addResult = spawnSync("node", [cliPath, ...addArgs], {
          stdio: "pipe",
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
      }
    }

    log.info("Running Codex via CLI...");

    try {
      const result = spawnSync("node", [cliPath, "exec", addInstructions(prompt)], {
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
});
