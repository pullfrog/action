import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { claude } from "./agents/claude.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import packageJson from "./package.json" with { type: "json" };
import { log } from "./utils/cli.ts";
import { parseRepoContext, setupGitHubInstallationToken } from "./utils/github.ts";
import { setupGitAuth, setupGitConfig } from "./utils/setup.ts";

export const Inputs = type({
  prompt: "string",
  "anthropic_api_key?": "string | undefined",
});

export type Inputs = typeof Inputs.infer;

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export type PromptJSON = {};

async function printDirectoryTree(dir: string, prefix = "", rootDir = dir): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const currentPrefix = isLast ? "└── " : "├── ";
    const nextPrefix = isLast ? "    " : "│   ";

    const fullPath = join(dir, entry.name);
    lines.push(`${prefix}${currentPrefix}${entry.name}`);

    if (entry.isDirectory()) {
      const subTree = await printDirectoryTree(fullPath, `${prefix}${nextPrefix}`, rootDir);
      lines.push(subTree);
    }
  }

  return lines.join("\n");
}

export async function main(inputs: Inputs): Promise<MainResult> {
  try {
    // Debug: Print current directory tree before anything runs
    const cwd = process.cwd();
    log.info(`Current working directory: ${cwd}`);
    try {
      const tree = await printDirectoryTree(cwd);
      log.info(`Directory tree:\n${tree}`);
    } catch (error) {
      log.warning(
        `Failed to print directory tree: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);

    setupGitConfig();

    const githubInstallationToken = await setupGitHubInstallationToken();
    const repoContext = parseRepoContext();

    setupGitAuth(githubInstallationToken, repoContext);

    const mcpServers = createMcpConfigs(githubInstallationToken);

    log.debug(`📋 MCP Config: ${JSON.stringify(mcpServers, null, 2)}`);

    // Install Claude CLI before running
    await claude.install();

    log.info("Running Claude Agent SDK...");
    log.box(inputs.prompt, { title: "Prompt" });

    // TODO: check if `inputs.prompts` is JSON
    // if yes, check if it's a webhook payload or toJSON(github.event)
    // for webhook payloads, check the specified `agent` field

    const result = await claude.run({
      prompt: inputs.prompt,
      mcpServers,
      githubInstallationToken,
      apiKey: inputs.anthropic_api_key!,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Agent execution failed",
        output: result.output!,
      };
    }

    log.success("Task complete.");
    await log.writeSummary();

    return {
      success: true,
      output: result.output || "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    await log.writeSummary();
    return {
      success: false,
      error: errorMessage,
    };
  }
}
