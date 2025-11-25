import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Payload } from "../external.ts";
import { log } from "./cli.ts";
import type { RepoContext } from "./github.ts";
import { $ } from "./shell.ts";

// Store original remote URL for cleanup (only thing we need to restore)
let originalRemoteUrl: string | null = null;

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
 * Uses --local flag to scope config to the current repo only
 */
export function setupGitConfig(): void {
  const repoDir = process.cwd();
  log.info("🔧 Setting up git configuration...");
  try {
    // Use --local to scope config to this repo only, preventing leakage to user's global config
    execSync('git config --local user.email "action@pullfrog.ai"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync('git config --local user.name "Pullfrog Action"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    log.debug("setupGitConfig: ✓ Git configuration set successfully (scoped to repo)");
  } catch (error) {
    // If git config fails, log warning but don't fail the action
    // This can happen if we're not in a git repo or git isn't available
    log.warning(
      `Failed to set git config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Setup git authentication using GitHub installation token
 * Always uses the installation token, scoped to the current repo only
 */
export function setupGitAuth(githubToken: string, repoContext: RepoContext): void {
  const repoDir = process.cwd();

  // Store original remote URL for cleanup
  try {
    originalRemoteUrl =
      execSync("git config --local --get remote.origin.url", {
        cwd: repoDir,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim() || null;
  } catch {
    originalRemoteUrl = null;
  }

  log.info("🔐 Setting up git authentication...");

  // Remove existing git auth headers that actions/checkout might have set
  // Use --local to scope to this repo only
  try {
    execSync("git config --local --unset-all http.https://github.com/.extraheader", {
      cwd: repoDir,
      stdio: "pipe",
    });
    log.info("✓ Removed existing authentication headers");
  } catch {
    log.debug("No existing authentication headers to remove");
  }

  // Update remote URL to embed the token
  // This is scoped to the repo's .git/config, not the user's global config
  const remoteUrl = `https://x-access-token:${githubToken}@github.com/${repoContext.owner}/${repoContext.name}.git`;
  $("git", ["remote", "set-url", "origin", remoteUrl], { cwd: repoDir });
  log.info("✓ Updated remote URL with authentication token (scoped to repo)");
}

/**
 * Setup git branch based on payload event context
 * Automatically checks out the appropriate branch before agent execution
 */
export function setupGitBranch(payload: Payload): void {
  const branch = payload.event.branch;
  const repoDir = process.cwd();

  if (!branch) {
    log.debug("No branch specified in payload, using default branch");
    return;
  }

  log.info(`🌿 Setting up git branch: ${branch}`);

  try {
    // Fetch the branch from origin
    log.debug(`Fetching branch from origin: ${branch}`);
    execSync(`git fetch origin ${branch}`, {
      cwd: repoDir,
      stdio: "pipe",
    });

    // Checkout the branch, creating local tracking branch
    log.debug(`Checking out branch: ${branch}`);
    execSync(`git checkout -B ${branch} origin/${branch}`, {
      cwd: repoDir,
      stdio: "pipe",
    });

    log.info(`✓ Successfully checked out branch: ${branch}`);
  } catch (error) {
    // If git operations fail, log warning but don't fail the action
    // The agent might still be able to work with the default branch
    log.warning(
      `Failed to checkout branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Clean up local git configuration after action completes
 * Removes the --local config entries we added so the repo returns to its original state
 * Only runs in local development (not in GitHub Actions)
 */
export function restoreGitConfig(): void {
  if (process.env.GITHUB_ACTIONS) {
    return;
  }

  const repoDir = process.cwd();
  log.info("🔄 Cleaning up git configuration...");

  try {
    try {
      execSync("git config --local --unset user.email", {
        cwd: repoDir,
        stdio: "pipe",
      });
      log.debug("✓ Removed local user.email");
    } catch {
      // Ignore if unset fails (config might not exist)
    }

    try {
      execSync("git config --local --unset user.name", {
        cwd: repoDir,
        stdio: "pipe",
      });
      log.debug("✓ Removed local user.name");
    } catch {
      // Ignore if unset fails (config might not exist)
    }

    // Restore original remote URL if we stored it
    if (originalRemoteUrl !== null) {
      try {
        $("git", ["remote", "set-url", "origin", originalRemoteUrl], { cwd: repoDir });
        log.debug("✓ Restored original remote URL");
      } catch (error) {
        log.warning(
          `Failed to restore remote URL: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    log.info("✓ Git configuration cleanup completed");
  } catch (error) {
    // Log warning but don't fail - this is cleanup
    log.warning(
      `Failed to clean up git config: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    // Clear stored remote URL
    originalRemoteUrl = null;
  }
}
