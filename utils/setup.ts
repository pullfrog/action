import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Context } from "../main.ts";
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
 * For PR events, always returns a push URL constructed from the PR's head repo.
 * This works for both same-repo and fork PRs with a single code path.
 */
export async function setupGit(ctx: Context): Promise<SetupGitResult> {
  const repoDir = process.cwd();

  log.info("🔧 Setting up git authentication...");

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

  // set up origin with token (needed for fetch operations)
  const originUrl = `https://x-access-token:${ctx.githubInstallationToken}@github.com/${ctx.owner}/${ctx.name}.git`;
  $("git", ["remote", "set-url", "origin", originUrl], { cwd: repoDir });
  log.info("✓ Updated origin URL with authentication token");

  // non-PR events: stay on default branch
  if (ctx.payload.event.is_pr !== true || !ctx.payload.event.issue_number) {
    return { pushRemote: "origin" };
  }

  // PR event: fetch PR info to get branch name and head repo
  const prNumber = ctx.payload.event.issue_number;
  const pr = await ctx.octokit.rest.pulls.get({
    owner: ctx.owner,
    repo: ctx.name,
    pull_number: prNumber,
  });

  const headRepo = pr.data.head.repo;
  if (!headRepo) {
    throw new Error(`PR #${prNumber} source repository was deleted`);
  }

  // checkout PR branch using plain git (no gh cli needed)
  const branch = pr.data.head.ref;
  log.info(`🌿 Checking out PR #${prNumber} (${branch})...`);
  $("git", ["fetch", "--no-tags", "origin", `pull/${prNumber}/head:${branch}`], { cwd: repoDir });
  $("git", ["checkout", branch], { cwd: repoDir });
  log.info(`✓ Successfully checked out PR #${prNumber}`);

  // unified push URL - works for both same-repo and fork PRs
  const token = process.env.GITHUB_TOKEN || ctx.githubInstallationToken;
  const pushUrl = `https://x-access-token:${token}@github.com/${headRepo.full_name}.git`;
  const isFork = headRepo.full_name !== pr.data.base.repo.full_name;
  if (isFork) {
    log.info(`🍴 Fork PR detected, will push to: ${headRepo.full_name}`);
  }
  return { pushRemote: pushUrl };
}
