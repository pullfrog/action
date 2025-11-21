import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Payload } from "../external.ts";
import { log } from "./cli.ts";
import type { RepoContext } from "./github.ts";
import { $ } from "./shell.ts";

export interface SetupOptions {
  tempDir: string;
  repoUrl?: string;
  forceClean?: boolean;
}

/**
 * Setup the test repository for running actions
 */
export function setupTestRepo(options: SetupOptions): void {
  const {
    tempDir,
    repoUrl = "git@github.com:pullfrogai/scratch.git",
    forceClean = false,
  } = options;

  if (existsSync(tempDir)) {
    if (forceClean) {
      log.info("🗑️  Removing existing .temp directory...");
      rmSync(tempDir, { recursive: true, force: true });

      log.info("📦 Cloning pullfrogai/scratch into .temp...");
      $("git", ["clone", repoUrl, tempDir]);
    } else {
      log.info("📦 Resetting existing .temp repository...");
      execSync("git reset --hard HEAD && git clean -fd", {
        cwd: tempDir,
        stdio: "inherit",
      });
    }
  } else {
    log.info("📦 Cloning pullfrogai/scratch into .temp...");
    $("git", ["clone", repoUrl, tempDir]);
  }
}

/**
 * Setup git configuration to avoid identity errors
 * Only runs in GitHub Actions environment to avoid overwriting local git config
 */
export function setupGitConfig(): void {
  // Only set up git config in GitHub Actions environment
  // In local development, use the user's existing git config
  if (!process.env.GITHUB_ACTIONS) {
    return;
  }

  log.info("🔧 Setting up git configuration...");
  try {
    execSync('git config user.email "action@pullfrog.ai"', { stdio: "pipe" });
    execSync('git config user.name "Pullfrog Action"', { stdio: "pipe" });
    log.debug("setupGitConfig: ✓ Git configuration set successfully");
  } catch (error) {
    // If git config fails, log warning but don't fail the action
    // This can happen if we're not in a git repo or git isn't available
    log.warning(
      `Failed to set git config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Setup git authentication using GitHub token
 * Only runs in GitHub Actions environment to avoid breaking local git remotes
 */
export function setupGitAuth(githubToken: string, repoContext: RepoContext): void {
  // Only set up git auth in GitHub Actions environment
  // In local testing, this would overwrite the real git remote with fake credentials
  if (!process.env.GITHUB_ACTIONS) {
    return;
  }

  log.info("🔐 Setting up git authentication...");

  // Remove existing git auth headers that actions/checkout might have set
  try {
    execSync("git config --unset-all http.https://github.com/.extraheader", { stdio: "inherit" });
    log.info("✓ Removed existing authentication headers");
  } catch {
    log.info("No existing authentication headers to remove");
  }

  // Update remote URL to embed the token
  const remoteUrl = `https://x-access-token:${githubToken}@github.com/${repoContext.owner}/${repoContext.name}.git`;
  $("git", ["remote", "set-url", "origin", remoteUrl]);
  log.info("✓ Updated remote URL with authentication token");
}

/**
 * Setup git branch based on payload event context
 * Automatically checks out the appropriate branch before agent execution
 */
export function setupGitBranch(payload: Payload): void {
  // Only set up git branch in GitHub Actions environment
  // In local testing, this might interfere with local git state
  if (!process.env.GITHUB_ACTIONS) {
    return;
  }

  const branch = payload.event.branch;

  if (!branch) {
    log.debug("No branch specified in payload, using default branch");
    return;
  }

  log.info(`🌿 Setting up git branch: ${branch}`);

  try {
    // Fetch the branch from origin
    log.debug(`Fetching branch from origin: ${branch}`);
    execSync(`git fetch origin ${branch}`, { stdio: "pipe" });

    // Checkout the branch, creating local tracking branch
    log.debug(`Checking out branch: ${branch}`);
    execSync(`git checkout -B ${branch} origin/${branch}`, { stdio: "pipe" });

    log.info(`✓ Successfully checked out branch: ${branch}`);
  } catch (error) {
    // If git operations fail, log warning but don't fail the action
    // The agent might still be able to work with the default branch
    log.warning(
      `Failed to checkout branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
