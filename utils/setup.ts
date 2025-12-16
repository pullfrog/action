import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Payload } from "../external.ts";
import { log } from "./cli.ts";
import type { RepoContext } from "./github.ts";
import { $ } from "./shell.ts";

export interface SetupOptions {
  tempDir: string;
  forceClean?: boolean;
}

/**
 * Setup the test repository for running actions
 */
export function setupTestRepo(options: SetupOptions): void {
  const { tempDir, forceClean = false } = options;

  if (existsSync(tempDir)) {
    if (forceClean) {
      log.info("🗑️  Removing existing .temp directory...");
      rmSync(tempDir, { recursive: true, force: true });

      log.info("📦 Cloning pullfrog/scratch into .temp...");
      $("git", ["clone", "git@github.com:pullfrog/scratch.git", tempDir]);
    } else {
      log.info("📦 Resetting existing .temp repository...");
      execSync("git reset --hard HEAD && git clean -fd", {
        cwd: tempDir,
        stdio: "inherit",
      });
    }
  } else {
    log.info("📦 Cloning pullfrog/scratch into .temp...");
    $("git", ["clone", "git@github.com:pullfrog/scratch.git", tempDir]);
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
    execSync('git config --local user.email "team@pullfrog.com"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync('git config --local user.name "pullfrog"', {
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
export function setupGitAuth(ctx: {
  githubInstallationToken: string;
  repoContext: RepoContext;
}): void {
  const repoDir = process.cwd();

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
  const remoteUrl = `https://x-access-token:${ctx.githubInstallationToken}@github.com/${ctx.repoContext.owner}/${ctx.repoContext.name}.git`;
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

  // if event has issue_number and branch, it's likely a PR - try PR ref first (works for forks)
  const issueNumber = "issue_number" in payload.event ? payload.event.issue_number : undefined;
  const isLikelyPR = issueNumber !== undefined && branch !== undefined;

  if (isLikelyPR) {
    try {
      // use GitHub's PR ref which works for both fork and non-fork PRs
      log.debug(`Fetching PR #${issueNumber} using refs/pull/${issueNumber}/head`);
      execSync(`git fetch origin refs/pull/${issueNumber}/head`, {
        cwd: repoDir,
        stdio: "pipe",
      });

      // checkout from FETCH_HEAD (the PR ref we just fetched)
      log.debug(`Checking out branch: ${branch}`);
      execSync(`git checkout -B ${branch} FETCH_HEAD`, {
        cwd: repoDir,
        stdio: "pipe",
      });

      log.info(`✓ Successfully checked out PR branch: ${branch}`);
      return;
    } catch (error) {
      // if PR ref fetch fails, fall back to branch name fetch
      log.debug(
        `PR ref fetch failed, falling back to branch name fetch: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // fallback: fetch by branch name (for non-PR contexts or if PR ref fetch failed)
  try {
    log.debug(`Fetching branch from origin: ${branch}`);
    execSync(`git fetch origin ${branch}`, {
      cwd: repoDir,
      stdio: "pipe",
    });

    // checkout the branch, creating local tracking branch
    log.debug(`Checking out branch: ${branch}`);
    execSync(`git checkout -B ${branch} origin/${branch}`, {
      cwd: repoDir,
      stdio: "pipe",
    });

    log.info(`✓ Successfully checked out branch: ${branch}`);
  } catch (error) {
    // if git operations fail, log warning but don't fail the action
    // the agent might still be able to work with the default branch
    log.warning(
      `Failed to checkout branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
