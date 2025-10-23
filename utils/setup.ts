import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
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
      console.log("🗑️  Removing existing .temp directory...");
      rmSync(tempDir, { recursive: true, force: true });

      console.log("📦 Cloning pullfrogai/scratch into .temp...");
      execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });
    } else {
      console.log("📦 Resetting existing .temp repository...");
      execSync("git reset --hard HEAD && git clean -fd", {
        cwd: tempDir,
        stdio: "inherit",
      });
    }
  } else {
    console.log("📦 Cloning pullfrogai/scratch into .temp...");
    execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });
  }
}

/**
 * Setup git configuration to avoid identity errors
 */
export function setupGitConfig(): void {
  console.log("🔧 Setting up git configuration...");
  execSync('git config --global user.email "action@pullfrog.ai"', { stdio: "inherit" });
  execSync('git config --global user.name "Pullfrog Action"', { stdio: "inherit" });
}

/**
 * Setup git authentication using GitHub token
 */
export function setupGitAuth(githubToken: string, repoContext: RepoContext): void {
  console.log("🔐 Setting up git authentication...");

  // Remove existing git auth headers that actions/checkout might have set
  try {
    execSync("git config --unset-all http.https://github.com/.extraheader", { stdio: "inherit" });
    console.log("✓ Removed existing authentication headers");
  } catch {
    console.log("No existing authentication headers to remove");
  }

  // Update remote URL to embed the token
  const remoteUrl = `https://x-access-token:${githubToken}@github.com/${repoContext.owner}/${repoContext.name}.git`;
  execSync(`git remote set-url origin "${remoteUrl}"`, { stdio: "inherit" });
  console.log("✓ Updated remote URL with authentication token");
}
