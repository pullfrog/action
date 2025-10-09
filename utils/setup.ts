import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

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
 * Build the action bundles
 */
export function buildAction(actionPath: string): void {
  console.log("🔨 Building fresh bundles with esbuild...");
  execSync("node esbuild.config.js", {
    cwd: actionPath,
    stdio: "inherit",
  });
}
