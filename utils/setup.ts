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

/**
 * Setup git authentication for the repository.
 * PR checkout is handled dynamically by the checkout_pr MCP tool.
 *
 * FORK PR ARCHITECTURE (handled by checkout_pr tool):
 * - origin: always points to BASE REPO (where PR targets)
 * - checkout_pr sets per-branch pushRemote config for fork PRs
 * - diff operations use: git diff origin/<base>..HEAD
 */
export async function setupGit(ctx: Context): Promise<void> {
  const repoDir = process.cwd();

  log.info("🔧 setting up git authentication...");

  // remove existing git auth headers that actions/checkout might have set
  try {
    execSync("git config --local --unset-all http.https://github.com/.extraheader", {
      cwd: repoDir,
      stdio: "pipe",
    });
    log.info("✓ removed existing authentication headers");
  } catch {
    log.debug("no existing authentication headers to remove");
  }

  // authenticate origin - needed for all fetch operations including PR fetches
  const originUrl = `https://x-access-token:${ctx.githubInstallationToken}@github.com/${ctx.owner}/${ctx.name}.git`;
  $("git", ["remote", "set-url", "origin", originUrl], { cwd: repoDir });
  log.info("✓ updated origin URL with authentication token");
}
