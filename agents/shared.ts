import { spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { show } from "@ark/util";
import { type AgentManifest, type AgentName, agentsManifest, type Payload } from "../external.ts";
import { log } from "../utils/cli.ts";

/**
 * Result returned by agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for agent creation
 */
export interface AgentConfig {
  apiKey: string;
  githubInstallationToken: string;
  payload: Payload;
  mcpServers: Record<string, McpHttpServerConfig>;
  cliPath: string;
}

/**
 * Parameters for configuring MCP servers
 */
export interface ConfigureMcpServersParams {
  mcpServers: Record<string, McpHttpServerConfig>;
  cliPath: string;
}

/**
 * Parameters for installing from npm tarball
 */
export interface InstallFromNpmTarballParams {
  packageName: string;
  version: string;
  executablePath: string;
  installDependencies?: boolean;
}

/**
 * Parameters for installing from curl script
 */
export interface InstallFromCurlParams {
  installUrl: string;
  executableName: string;
}

/**
 * Parameters for installing from GitHub releases
 */
export interface InstallFromGithubParams {
  owner: string;
  repo: string;
  assetName?: string;
  executablePath?: string;
  githubInstallationToken?: string;
}

/**
 * NPM registry response data structure
 */
export interface NpmRegistryData {
  "dist-tags": { latest: string };
  versions: Record<string, unknown>;
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
}: InstallFromNpmTarballParams): Promise<string> {
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
      const registryData = (await registryResponse.json()) as NpmRegistryData;
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

  const tempDir = process.env.PULLFROG_TEMP_DIR!;
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

/**
 * Fetch with retry logic if Retry-After header is present
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  errorMessage: string
): Promise<Response> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After") || response.headers.get("retry-after");
    if (retryAfter) {
      const waitSeconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(waitSeconds) && waitSeconds > 0) {
        log.info(`Rate limited, waiting ${waitSeconds} seconds before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        const retryResponse = await fetch(url, { headers });
        if (!retryResponse.ok) {
          throw new Error(
            `${errorMessage}: ${retryResponse.status} ${retryResponse.statusText} (retry failed)`
          );
        }
        return retryResponse;
      }
    }
    throw new Error(`${errorMessage}: ${response.status} ${response.statusText}`);
  }
  return response;
}

/**
 * Install a CLI tool from GitHub releases
 * Downloads the latest release asset from GitHub and returns the path to the executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromGithub({
  owner,
  repo,
  assetName,
  executablePath,
  githubInstallationToken,
}: InstallFromGithubParams): Promise<string> {
  log.info(`📦 Installing ${owner}/${repo} from GitHub releases...`);

  // fetch release from GitHub API (latest)
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  log.info(`Fetching release from ${releaseUrl}...`);

  const headers: Record<string, string> = {};
  if (githubInstallationToken) {
    headers.Authorization = `Bearer ${githubInstallationToken}`;
  }

  const releaseResponse = await fetchWithRetry(releaseUrl, headers, "Failed to fetch release");

  const releaseData = (await releaseResponse.json()) as {
    tag_name: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
    }>;
  };

  log.info(`Found release: ${releaseData.tag_name}`);

  const asset = releaseData.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`Asset '${assetName}' not found in release ${releaseData.tag_name}`);
  }
  const assetUrl = asset.browser_download_url;

  log.info(`Downloading asset from ${assetUrl}...`);

  // create temp directory
  const tempDirPrefix = `${owner}-${repo}-github-`;
  const tempDir = await mkdtemp(join(tmpdir(), tempDirPrefix));

  // determine file extension and download path
  const urlPath = new URL(assetUrl).pathname;
  const fileName = urlPath.split("/").pop() || "asset";
  const downloadPath = join(tempDir, fileName);

  // download the asset
  const assetResponse = await fetchWithRetry(assetUrl, headers, "Failed to download asset");

  if (!assetResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(downloadPath);
  await pipeline(assetResponse.body, fileStream);
  log.info(`Downloaded asset to ${downloadPath}`);

  // determine the executable path
  let cliPath: string;
  if (executablePath) {
    cliPath = join(tempDir, executablePath);
  } else {
    // no executablePath, assume the downloaded file is the executable
    cliPath = downloadPath;
  }

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found at ${cliPath}`);
  }

  chmodSync(cliPath, 0o755);
  log.info(`✓ Installed from GitHub release at ${cliPath}`);

  return cliPath;
}

/**
 * Install a CLI tool from a curl-based install script
 * Downloads the install script, runs it with HOME set to temp directory, and returns the path to the CLI executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromCurl({
  installUrl,
  executableName,
}: InstallFromCurlParams): Promise<string> {
  log.info(`📦 Installing ${executableName}...`);

  const tempDir = process.env.PULLFROG_TEMP_DIR!;
  const installScriptPath = join(tempDir, "install.sh");

  // Download the install script
  log.info(`Downloading install script from ${installUrl}...`);
  const installScriptResponse = await fetch(installUrl);
  if (!installScriptResponse.ok) {
    throw new Error(`Failed to download install script: ${installScriptResponse.status}`);
  }

  if (!installScriptResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(installScriptPath);
  await pipeline(installScriptResponse.body, fileStream);
  log.info(`Downloaded install script to ${installScriptPath}`);

  // Make install script executable
  chmodSync(installScriptPath, 0o755);

  log.info(`Installing to temp directory at ${tempDir}...`);

  // Run the install script with HOME set to temp directory
  // The Cursor install script installs to $HOME/.local/bin/{executableName}
  // By setting HOME=tempDir, we ensure it installs to tempDir/.local/bin/{executableName}
  const installResult = spawnSync("bash", [installScriptPath], {
    cwd: tempDir,
    env: {
      HOME: tempDir, // Cursor install script uses HOME for installation path
      PATH: process.env.PATH || "",
      SHELL: process.env.SHELL || "/bin/bash",
      USER: process.env.USER || "",
      TMPDIR: process.env.TMPDIR || "/tmp",
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (installResult.status !== 0) {
    const errorOutput = installResult.stderr || installResult.stdout || "No output";
    throw new Error(
      `Failed to install ${executableName}. Install script exited with code ${installResult.status}. Output: ${errorOutput}`
    );
  }

  // The Cursor install script creates a symlink at $HOME/.local/bin/{executableName}
  // Since we set HOME=tempDir, the deterministic path is:
  const cliPath = join(tempDir, ".local", "bin", executableName);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found at ${cliPath}`);
  }

  // Ensure binary is executable
  chmodSync(cliPath, 0o755);
  log.info(`✓ ${executableName} installed at ${cliPath}`);

  return cliPath;
}

export const agent = <const input extends AgentInput>(input: input): defineAgent<input> => {
  return { ...input, ...agentsManifest[input.name] } as never;
};

export interface AgentInput {
  name: AgentName;
  install: () => Promise<string>;
  run: (config: AgentConfig) => Promise<AgentResult>;
}

export interface Agent extends AgentInput, AgentManifest {}

type agentManifest<name extends AgentName> = (typeof agentsManifest)[name];

type defineAgent<input extends AgentInput> = show<input & agentManifest<input["name"]>>;
