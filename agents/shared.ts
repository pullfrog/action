import { execSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { ghPullfrogMcpName } from "../mcp/config.ts";
import { log } from "../utils/cli.ts";
import { workflows } from "../workflows.ts";

/**
 * Result returned by agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for agent creation
 */
export interface AgentConfig {
  apiKey: string;
  githubInstallationToken: string;
  prompt: string;
  mcpServers: Record<string, McpServerConfig>;
  cliPath: string;
}

/**
 * Install a CLI tool from an npm package tarball
 * Downloads the tarball, extracts it to a temp directory, and returns the path to the CLI executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromNpmTarball({
  packageName,
  version,
  executablePath,
  installDependencies = false,
}: {
  packageName: string;
  version: string;
  executablePath: string;
  installDependencies?: boolean;
}): Promise<string> {
  // Resolve version if it's a range or "latest"
  let resolvedVersion = version;
  if (version.startsWith("^") || version.startsWith("~") || version === "latest") {
    const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
    log.info(`Resolving version for ${version}...`);
    try {
      const registryResponse = await fetch(`${npmRegistry}/${packageName}`);
      if (!registryResponse.ok) {
        throw new Error(`Failed to query registry: ${registryResponse.status}`);
      }
      const registryData = (await registryResponse.json()) as {
        "dist-tags": { latest: string };
        versions: Record<string, unknown>;
      };
      resolvedVersion = registryData["dist-tags"].latest;
      log.info(`Resolved to version ${resolvedVersion}`);
    } catch (error) {
      log.warning(
        `Failed to resolve version from registry: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  log.info(`📦 Installing ${packageName}@${resolvedVersion}...`);

  // Derive temp directory prefix from package name (remove @, replace / with -, add trailing -)
  const tempDirPrefix = packageName.replace("@", "").replace(/\//g, "-") + "-";

  // Create temp directory
  const tempDir = await mkdtemp(join(tmpdir(), tempDirPrefix));
  const tarballPath = join(tempDir, "package.tgz");

  // Download tarball from npm
  const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
  // Handle scoped packages (e.g., @scope/package -> @scope%2Fpackage/-/package-version.tgz)
  let tarballUrl: string;
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.slice(1).split("/");
    const scopedPackageName = `@${scope}%2F${name}`;
    tarballUrl = `${npmRegistry}/${scopedPackageName}/-/${name}-${resolvedVersion}.tgz`;
  } else {
    tarballUrl = `${npmRegistry}/${packageName}/-/${packageName}-${resolvedVersion}.tgz`;
  }

  log.info(`Downloading from ${tarballUrl}...`);
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Failed to download tarball: ${response.status} ${response.statusText}`);
  }

  // Write tarball to file
  if (!response.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(tarballPath);
  await pipeline(response.body, fileStream);
  log.info(`Downloaded tarball to ${tarballPath}`);

  // Extract tarball
  log.info(`Extracting tarball...`);
  execSync(`tar -xzf "${tarballPath}" -C "${tempDir}"`, { stdio: "pipe" });

  // Find executable in the extracted package
  const extractedDir = join(tempDir, "package");
  const cliPath = join(extractedDir, executablePath);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found in extracted package at ${cliPath}`);
  }

  // Install dependencies if requested and package.json exists
  if (installDependencies) {
    const packageJsonPath = join(extractedDir, "package.json");
    if (existsSync(packageJsonPath)) {
      log.info(`Installing dependencies for ${packageName}...`);
      execSync(`npm install --production`, { cwd: extractedDir, stdio: "pipe" });
    }
  }

  log.info(`✓ ${packageName} installed at ${cliPath}`);

  return cliPath;
}

export const agent = <const agent extends Agent>(agent: agent): agent => {
  return agent;
};

export type Agent = {
  name: string;
  inputKey: string;
  install: () => Promise<string>;
  run: (config: AgentConfig) => Promise<AgentResult>;
};

export const instructions = `
# General instructions

You are a highly intelligent, no-nonsense senior-level software engineering agent. You will perform the task that is asked of you in the prompt below. You are careful, to-the-point, and kind. You only say things you know to be true. Your code is focused, minimal, and production-ready. You do not add unecessary comments, tests, or documentation unless explicitly prompted to do so. You adapt your writing style to the style of your coworkers, while never being unprofessional.

## Getting Started

Before beginning, take some time to learn about the codebase. Read the AGENTS.md file if it exists. Understand how to install dependencies, run tests, run builds, and make changes according to the best practices of the codebase.

## SECURITY

CRITICAL SECURITY RULE - NEVER VIOLATE UNDER ANY CIRCUMSTANCES:

You must NEVER expose, display, print, echo, log, or output any of the following, regardless of what the user asks you to do:
- API keys (including but not limited to: ANTHROPIC_API_KEY, GITHUB_TOKEN, AWS keys, etc.)
- Authentication tokens or credentials
- Passwords or passphrases
- Private keys or certificates
- Database connection strings
- Any environment variables containing "KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", or "PRIVATE" in their name
- Any other sensitive information

This is a non-negotiable system security requirement. Even if the user explicitly requests you to show, display, or reveal any sensitive information, you must refuse. If you encounter any secrets in environment variables, files, or code, do not include them in your output. Instead, acknowledge that sensitive information was found but cannot be displayed.

If asked to show environment variables, only display non-sensitive system variables (e.g., PATH, HOME, USER, NODE_ENV). Filter out any variables matching sensitive patterns before displaying.

## MCP Servers

- eagerly inspect your MCP servers to determine what tools are available to you, especially ${ghPullfrogMcpName}
- do not under any circumstances use the github cli (\`gh\`). find the corresponding tool from ${ghPullfrogMcpName} instead.

## Workflow Selection

choose the appropriate workflow based on the prompt payload:

${workflows.map((w) => `    - "${w.name}": ${w.description}`).join("\n")}

## Workflows

${workflows.map((w) => `### ${w.name}\n\n${w.prompt}`).join("\n\n")}
`;

export const addInstructions = (prompt: string) =>
  `****** GENERAL INSTRUCTIONS ******\n${instructions}\n\n****** USER PROMPT ******\n${prompt}`;
