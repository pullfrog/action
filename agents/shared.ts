import { spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { log } from "../utils/cli.ts";

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
  installDependencies,
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
  const extractResult = spawnSync("tar", ["-xzf", tarballPath, "-C", tempDir], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (extractResult.status !== 0) {
    throw new Error(
      `Failed to extract tarball: ${extractResult.stderr || extractResult.stdout || "Unknown error"}`
    );
  }

  // Find executable in the extracted package
  const extractedDir = join(tempDir, "package");
  const cliPath = join(extractedDir, executablePath);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found in extracted package at ${cliPath}`);
  }

  // Install dependencies if requested
  if (installDependencies) {
    log.info(`Installing dependencies for ${packageName}...`);
    const installResult = spawnSync("npm", ["install", "--production"], {
      cwd: extractedDir,
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (installResult.status !== 0) {
      throw new Error(
        `Failed to install dependencies: ${installResult.stderr || installResult.stdout || "Unknown error"}`
      );
    }
    log.info(`✓ Dependencies installed`);
  }

  // Make the file executable
  chmodSync(cliPath, 0o755);

  log.info(`✓ ${packageName} installed at ${cliPath}`);

  return cliPath;
}

export const agent = <const agent extends Agent>(agent: agent): agent => {
  return agent;
};

/**
 * Parameters for adding an MCP server to an agent
 */
export interface AddMcpServerParams {
  serverName: string;
  serverConfig: Extract<McpServerConfig, { command: string }>;
  cliPath: string;
}

export type Agent = {
  name: string;
  inputKeys: string[];
  install: () => Promise<string>;
  addMcpServer: (params: AddMcpServerParams) => void;
  run: (config: AgentConfig) => Promise<AgentResult>;
};
