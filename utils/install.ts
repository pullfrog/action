import { spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { log } from "./cli.ts";

export interface InstallFromNpmTarballParams {
  packageName: string;
  version: string;
  executablePath: string;
  installDependencies?: boolean;
}

export interface InstallFromCurlParams {
  installUrl: string;
  executableName: string;
}

export interface InstallFromGithubParams {
  owner: string;
  repo: string;
  assetName?: string;
  executablePath?: string;
  githubInstallationToken?: string;
}

export interface InstallFromGithubTarballParams {
  owner: string;
  repo: string;
  assetNamePattern: string;
  executablePath: string;
  githubInstallationToken?: string;
}

interface NpmRegistryData {
  "dist-tags": { latest: string };
  versions: Record<string, unknown>;
}

/**
 * Install a CLI tool from an npm package tarball
 * Downloads the tarball, extracts it to a temp directory, and returns the path to the CLI executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromNpmTarball(params: InstallFromNpmTarballParams): Promise<string> {
  // Resolve version if it's a range or "latest"
  let resolvedVersion = params.version;
  if (
    params.version.startsWith("^") ||
    params.version.startsWith("~") ||
    params.version === "latest"
  ) {
    const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
    log.debug(`» resolving version for ${params.version}...`);
    try {
      const registryResponse = await fetch(`${npmRegistry}/${params.packageName}`);
      if (!registryResponse.ok) {
        throw new Error(`Failed to query registry: ${registryResponse.status}`);
      }
      const registryData = (await registryResponse.json()) as NpmRegistryData;
      resolvedVersion = registryData["dist-tags"].latest;
      log.debug(`» resolved to version ${resolvedVersion}`);
    } catch (error) {
      log.warning(
        `Failed to resolve version from registry: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  log.debug(`» installing ${params.packageName}@${resolvedVersion}...`);

  const tempDir = process.env.PULLFROG_TEMP_DIR!;
  const tarballPath = join(tempDir, "package.tgz");

  // Download tarball from npm
  const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
  // Handle scoped packages (e.g., @scope/package -> @scope%2Fpackage/-/package-version.tgz)
  let tarballUrl: string;
  if (params.packageName.startsWith("@")) {
    const [scope, name] = params.packageName.slice(1).split("/");
    const scopedPackageName = `@${scope}%2F${name}`;
    tarballUrl = `${npmRegistry}/${scopedPackageName}/-/${name}-${resolvedVersion}.tgz`;
  } else {
    tarballUrl = `${npmRegistry}/${params.packageName}/-/${params.packageName}-${resolvedVersion}.tgz`;
  }

  log.debug(`» downloading from ${tarballUrl}...`);
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Failed to download tarball: ${response.status} ${response.statusText}`);
  }

  // Write tarball to file
  if (!response.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(tarballPath);
  await pipeline(response.body, fileStream);
  log.debug(`» downloaded tarball to ${tarballPath}`);

  // Extract tarball
  log.debug(`» extracting tarball...`);
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
  const cliPath = join(extractedDir, params.executablePath);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found in extracted package at ${cliPath}`);
  }

  // Install dependencies if requested
  if (params.installDependencies) {
    log.debug(`» installing dependencies for ${params.packageName}...`);
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
    log.debug(`» dependencies installed`);
  }

  // Make the file executable
  chmodSync(cliPath, 0o755);

  log.debug(`» ${params.packageName} installed at ${cliPath}`);

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
        log.info(`» rate limited, waiting ${waitSeconds} seconds before retry...`);
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
export async function installFromGithub(params: InstallFromGithubParams): Promise<string> {
  log.info(`» installing ${params.owner}/${params.repo} from GitHub releases...`);

  // fetch release from GitHub API (latest)
  const releaseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/releases/latest`;
  log.debug(`» fetching release from ${releaseUrl}...`);

  const headers: Record<string, string> = {};
  if (params.githubInstallationToken) {
    headers.Authorization = `Bearer ${params.githubInstallationToken}`;
  }

  const releaseResponse = await fetchWithRetry(releaseUrl, headers, "Failed to fetch release");

  const releaseData = (await releaseResponse.json()) as {
    tag_name: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
    }>;
  };

  log.debug(`» found release ${releaseData.tag_name}`);

  const asset = releaseData.assets.find((a) => a.name === params.assetName);
  if (!asset) {
    throw new Error(`Asset '${params.assetName}' not found in release ${releaseData.tag_name}`);
  }
  const assetUrl = asset.browser_download_url;

  log.debug(`» downloading asset from ${assetUrl}...`);

  // create temp directory
  const tempDirPrefix = `${params.owner}-${params.repo}-github-`;
  const tempDirPath = await mkdtemp(join(tmpdir(), tempDirPrefix));

  // determine file extension and download path
  const urlPath = new URL(assetUrl).pathname;
  const fileName = urlPath.split("/").pop() || "asset";
  const downloadPath = join(tempDirPath, fileName);

  // download the asset
  const assetResponse = await fetchWithRetry(assetUrl, headers, "Failed to download asset");

  if (!assetResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(downloadPath);
  await pipeline(assetResponse.body, fileStream);
  log.debug(`» downloaded asset to ${downloadPath}`);

  // determine the executable path
  let cliPath: string;
  if (params.executablePath) {
    cliPath = join(tempDirPath, params.executablePath);
  } else {
    // no executablePath, assume the downloaded file is the executable
    cliPath = downloadPath;
  }

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found at ${cliPath}`);
  }

  chmodSync(cliPath, 0o755);
  log.info(`» installed from GitHub release at ${cliPath}`);

  return cliPath;
}

/**
 * Install a CLI tool from a GitHub release tarball
 * Downloads the tar.gz from GitHub releases, extracts it, and returns the path to the CLI executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromGithubTarball(
  params: InstallFromGithubTarballParams
): Promise<string> {
  log.info(`» installing ${params.owner}/${params.repo} from GitHub releases...`);

  // determine platform-specific asset name
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const assetName = params.assetNamePattern.replace("{os}", os).replace("{arch}", arch);

  // fetch release from GitHub API (latest)
  const releaseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/releases/latest`;
  log.info(`» fetching release from ${releaseUrl}...`);

  const headers: Record<string, string> = {};
  if (params.githubInstallationToken) {
    headers.Authorization = `Bearer ${params.githubInstallationToken}`;
  }

  const releaseResponse = await fetchWithRetry(releaseUrl, headers, "Failed to fetch release");

  const releaseData = (await releaseResponse.json()) as {
    tag_name: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
    }>;
  };

  log.debug(`» found release: ${releaseData.tag_name}`);

  const asset = releaseData.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`Asset '${assetName}' not found in release ${releaseData.tag_name}`);
  }
  const assetUrl = asset.browser_download_url;

  log.debug(`» downloading asset from ${assetUrl}...`);

  const tempDir = process.env.PULLFROG_TEMP_DIR!;
  const tarballPath = join(tempDir, assetName);

  // download the asset
  const assetResponse = await fetchWithRetry(assetUrl, headers, "Failed to download asset");

  if (!assetResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(tarballPath);
  await pipeline(assetResponse.body, fileStream);
  log.debug(`» downloaded tarball to ${tarballPath}`);

  // extract tar.gz
  log.debug(`» extracting tarball...`);
  const extractResult = spawnSync("tar", ["-xzf", tarballPath, "-C", tempDir], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (extractResult.status !== 0) {
    throw new Error(
      `Failed to extract tarball: ${extractResult.stderr || extractResult.stdout || "Unknown error"}`
    );
  }

  // find executable in the extracted tarball
  const cliPath = join(tempDir, params.executablePath);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found in extracted tarball at ${cliPath}`);
  }

  // make the file executable
  chmodSync(cliPath, 0o755);

  log.info(`» ${params.owner}/${params.repo} installed at ${cliPath}`);

  return cliPath;
}

/**
 * Install a CLI tool from a curl-based install script
 * Downloads the install script, runs it with HOME set to temp directory, and returns the path to the CLI executable
 * The temp directory will be cleaned up by the OS automatically
 */
export async function installFromCurl(params: InstallFromCurlParams): Promise<string> {
  log.info(`» installing ${params.executableName}...`);

  const tempDir = process.env.PULLFROG_TEMP_DIR!;
  const installScriptPath = join(tempDir, "install.sh");

  // Download the install script
  log.debug(`» downloading install script from ${params.installUrl}...`);
  const installScriptResponse = await fetch(params.installUrl);
  if (!installScriptResponse.ok) {
    throw new Error(`Failed to download install script: ${installScriptResponse.status}`);
  }

  if (!installScriptResponse.body) throw new Error("Response body is null");
  const fileStream = createWriteStream(installScriptPath);
  await pipeline(installScriptResponse.body, fileStream);
  log.debug(`» downloaded install script to ${installScriptPath}`);

  // Make install script executable
  chmodSync(installScriptPath, 0o755);

  log.debug(`» installing to temp directory at ${tempDir}...`);

  const installResult = spawnSync("bash", [installScriptPath], {
    cwd: tempDir,
    env: {
      // Run the install script with HOME set to temp directory
      // ensuring a fresh install for each run
      HOME: tempDir,
      // XDG_CONFIG_HOME must match HOME so CLI tools find config in the right place
      XDG_CONFIG_HOME: join(tempDir, ".config"),
      SHELL: process.env.SHELL,
      USER: process.env.USER,
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (installResult.status !== 0) {
    const errorOutput = installResult.stderr || installResult.stdout || "No output";
    throw new Error(
      `Failed to install ${params.executableName}. Install script exited with code ${installResult.status}. Output: ${errorOutput}`
    );
  }

  // The Cursor install script creates a symlink at $HOME/.local/bin/{executableName}
  // Since we set HOME=tempDir, the deterministic path is:
  const cliPath = join(tempDir, ".local", "bin", params.executableName);

  if (!existsSync(cliPath)) {
    throw new Error(`Executable not found at ${cliPath}`);
  }

  // Ensure binary is executable
  chmodSync(cliPath, 0o755);
  log.info(`» ${params.executableName} installed at ${cliPath}`);

  return cliPath;
}
