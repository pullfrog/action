import { spawnSync } from "node:child_process";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import { agent, type ConfigureMcpServersParams, installFromGithub } from "./shared.ts";

export const gemini = agent({
  name: "gemini",
  inputKeys: ["google_api_key", "gemini_api_key"],
  install: async () => {
    return await installFromGithub({
      owner: "google-gemini",
      repo: "gemini-cli",
      tag: "v0.16.0",
      assetName: "gemini.js",
    });
  },
  run: async ({ payload, apiKey, mcpServers, githubInstallationToken, cliPath }) => {
    configureGeminiMcpServers({ mcpServers, cliPath });
    if (!apiKey) {
      throw new Error("google_api_key or gemini_api_key is required for gemini agent");
    }

    // Set environment variables for Gemini CLI and MCP servers
    process.env.GEMINI_API_KEY = apiKey;
    process.env.GITHUB_INSTALLATION_TOKEN = githubInstallationToken;

    const sessionPrompt = addInstructions(payload);
    log.info(`Starting Gemini CLI with prompt: ${payload.prompt.substring(0, 100)}...`);

    let finalOutput = "";
    try {
      const result = await spawn({
        cmd: "node",
        args: [cliPath, "--yolo", "--output-format=text", "-p", sessionPrompt],
        env: {
          GEMINI_API_KEY: apiKey,
          GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
          GEMINI_CLI_DISABLE_SCHEMA_VALIDATION: "1",
        },
        onStdout: (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            log.info(trimmed);
            finalOutput += trimmed + "\n";
          }
        },
        onStderr: (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            log.warning(trimmed);
            finalOutput += trimmed + "\n";
          }
        },
      });

      if (result.exitCode !== 0) {
        const errorMessage = result.stderr || result.stdout || "Unknown error";
        log.error(`Gemini CLI exited with code ${result.exitCode}: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          output: finalOutput || result.stdout || "",
        };
      }

      finalOutput = finalOutput || result.stdout || "Gemini CLI completed successfully.";
      log.info("✓ Gemini CLI completed successfully");

      return {
        success: true,
        output: finalOutput,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to run Gemini CLI: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: finalOutput || "",
      };
    }
  },
});

/**
 * Configure MCP servers for Gemini using the CLI.
 * Gemini CLI syntax: gemini mcp add <name> <commandOrUrl> [args...] --env KEY=value
 */
function configureGeminiMcpServers({ mcpServers, cliPath }: ConfigureMcpServersParams): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const command = serverConfig.command;
    const args = serverConfig.args || [];
    const envVars = serverConfig.env || {};

    const addArgs = ["mcp", "add", serverName, command, ...args];

    for (const [key, value] of Object.entries(envVars)) {
      addArgs.push("--env", `${key}=${value}`);
    }

    log.info(`Adding MCP server '${serverName}'...`);
    const addResult = spawnSync("node", [cliPath, ...addArgs], {
      stdio: "pipe",
      encoding: "utf-8",
    });

    if (addResult.status !== 0) {
      throw new Error(
        `gemini mcp add failed: ${addResult.stderr || addResult.stdout || "Unknown error"}`
      );
    }
    log.info(`✓ MCP server '${serverName}' configured`);
  }
}
