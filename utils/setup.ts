import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Payload } from "../external.ts";
import { log } from "./cli.ts";
import { getGitHubInstallationToken, type RepoContext } from "./github.ts";
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
 * Setup git branch based on payload event context.
 * For PR events, uses `gh pr checkout` which handles fork PRs automatically.
 * For non-PR events, stays on the default branch.
 */
export function setupGitBranch(payload: Payload): void {
  // only checkout for PR events - use issue_number directly (no dependency on branch field)
  if (payload.event.is_pr !== true || !payload.event.issue_number) {
    log.debug("Not a PR event, staying on default branch");
    return;
  }

  const prNumber = payload.event.issue_number;
  const repoDir = process.cwd();

  log.info(`🌿 Checking out PR #${prNumber}...`);

  // gh pr checkout handles fork PRs by setting up remotes automatically
  const token = getGitHubInstallationToken();
  $("gh", ["pr", "checkout", prNumber.toString()], {
    cwd: repoDir,
    env: { GH_TOKEN: token },
  });

  log.info(`✓ Successfully checked out PR #${prNumber}`);
}
