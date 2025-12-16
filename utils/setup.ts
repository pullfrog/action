import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { MainContext } from "../main.ts";
import { log } from "./cli.ts";
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

export type SetupGitResult = {
  pushRemote: string;
};

/**
 * Unified git setup: configures authentication and checks out PR branch if applicable.
 * Uses gh as credential helper so git push works with any remote (including forks).
 * For PR events, gh pr checkout sets up proper remote tracking.
 * Returns the remote to push to (detected from branch tracking after checkout).
 */
export function setupGit(ctx: MainContext): SetupGitResult {
  const { githubInstallationToken, payload } = ctx;
  const repoDir = process.cwd();

  log.info("🔧 Setting up git configuration...");

  // remove existing git auth headers that actions/checkout might have set
  try {
    execSync("git config --local --unset-all http.https://github.com/.extraheader", {
      cwd: repoDir,
      stdio: "pipe",
    });
    log.info("✓ Removed existing authentication headers");
  } catch {
    log.debug("No existing authentication headers to remove");
  }

  // set up gh as credential helper - this makes git use GH_TOKEN for any remote
  $("git", ["config", "--local", "credential.helper", ""], { cwd: repoDir });
  $("git", ["config", "--local", "--add", "credential.helper", "!gh auth git-credential"], {
    cwd: repoDir,
    env: { GH_TOKEN: githubInstallationToken },
  });
  log.info("✓ Configured gh as credential helper");

  // non-PR events: stay on default branch, push to origin
  if (payload.event.is_pr !== true || !payload.event.issue_number) {
    log.debug("Not a PR event, staying on default branch");
    return { pushRemote: "origin" };
  }

  // checkout PR branch - gh pr checkout handles fork remotes and tracking automatically
  const prNumber = payload.event.issue_number;
  log.info(`🌿 Checking out PR #${prNumber}...`);
  $("gh", ["pr", "checkout", prNumber.toString()], {
    cwd: repoDir,
    env: { GH_TOKEN: githubInstallationToken },
  });
  log.info(`✓ Successfully checked out PR #${prNumber}`);

  // detect the push remote from branch tracking (set by gh pr checkout)
  const pushRemote = detectPushRemote();
  if (pushRemote !== "origin") {
    log.info(`🍴 Fork PR detected, will push to remote: ${pushRemote}`);
  }
  return { pushRemote };
}

function detectPushRemote(): string {
  try {
    const branch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false });
    const upstream = $("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], {
      log: false,
    });
    // upstream is like "remote/branch", extract remote name
    return upstream.split("/")[0];
  } catch {
    return "origin";
  }
}
