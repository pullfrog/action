import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { log } from "./cli.ts";
import type { RepoContext } from "./github.ts";

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
      execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });
    } else {
      log.info("📦 Resetting existing .temp repository...");
      execSync("git reset --hard HEAD && git clean -fd", {
        cwd: tempDir,
        stdio: "inherit",
      });
    }
  } else {
    log.info("📦 Cloning pullfrogai/scratch into .temp...");
    execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });
  }
}

/**
 * Setup git configuration to avoid identity errors
 */
export function setupGitConfig(): void {
  log.info("🔧 Setting up git configuration...");
  execSync('git config user.email "action@pullfrog.ai"', { stdio: "inherit" });
  execSync('git config user.name "Pullfrog Action"', { stdio: "inherit" });
}

/**
 * Setup git authentication using GitHub token
 */
export function setupGitAuth(githubToken: string, repoContext: RepoContext): void {
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
  execSync(`git remote set-url origin "${remoteUrl}"`, { stdio: "inherit" });
  log.info("✓ Updated remote URL with authentication token");
}
