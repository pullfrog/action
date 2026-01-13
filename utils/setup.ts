import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type { Payload } from "../external.ts";
import type { ToolState } from "../main.ts";
import { checkoutPrBranch } from "../mcp/checkout.ts";
import { log } from "./cli.ts";
import type { OctokitWithPlugins } from "./github.ts";
import { $ } from "./shell.ts";

export interface SetupOptions {
  tempDir: string;
}

/**
 * Setup the test repository for running actions
 */
export function setupTestRepo(options: SetupOptions): void {
  const { tempDir } = options;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is required");
  if (existsSync(tempDir)) {
    log.info("» removing existing .temp directory...");
    rmSync(tempDir, { recursive: true, force: true });
  }
  log.info(`» cloning ${repo} into .temp...`);
  $("git", ["clone", `git@github.com:${repo}.git`, tempDir]);
}

/**
 * Setup git configuration to avoid identity errors
 * Uses --local flag to scope config to the current repo only
 * Only sets defaults if not already configured (respects workflow config)
 */
export function setupGitConfig(): void {
  const repoDir = process.cwd();
  log.info("» setting up git configuration...");
  try {
    // check current config - only set defaults if not configured or using generic bot
    let currentEmail = "";
    try {
      currentEmail = execSync("git config user.email", {
        cwd: repoDir,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
    } catch {
      // not configured
    }

    const shouldSetDefaults =
      !currentEmail || currentEmail === "github-actions[bot]@users.noreply.github.com";

    if (shouldSetDefaults) {
      execSync('git config --local user.email "team@pullfrog.com"', {
        cwd: repoDir,
        stdio: "pipe",
      });
      execSync('git config --local user.name "pullfrog"', {
        cwd: repoDir,
        stdio: "pipe",
      });
      log.debug("» git user configured (using defaults)");
    } else {
      log.debug(`» git user already configured (${currentEmail}), skipping`);
    }

    // disable credential helper to prevent macOS keychain prompts when using x-access-token
    // only needed locally - GitHub Actions doesn't have this issue
    if (!process.env.GITHUB_ACTIONS) {
      execSync('git config --local credential.helper ""', {
        cwd: repoDir,
        stdio: "pipe",
      });
    }
  } catch (error) {
    // If git config fails, log warning but don't fail the action
    // This can happen if we're not in a git repo or git isn't available
    log.warning(
      `Failed to set git config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

interface SetupGitAuthParams {
  token: string;
  owner: string;
  name: string;
  payload: Payload;
  octokit: OctokitWithPlugins;
  toolState: ToolState;
}

/**
 * Setup git authentication for the repository.
 * For PR events, uses the shared checkoutPrBranch helper (also used by checkout_pr MCP tool).
 *
 * FORK PR ARCHITECTURE:
 * - origin: always points to BASE REPO (where PR targets)
 * - checkoutPrBranch sets per-branch pushRemote config for fork PRs
 * - checkout_pr returns the PR diff via GitHub API (authoritative source)
 */
export async function setupGitAuth(params: SetupGitAuthParams): Promise<void> {
  const repoDir = process.cwd();

  log.info("» setting up git authentication...");

  // remove existing git auth headers that actions/checkout might have set
  try {
    execSync("git config --local --unset-all http.https://github.com/.extraheader", {
      cwd: repoDir,
      stdio: "pipe",
    });
    log.info("» removed existing authentication headers");
  } catch {
    log.debug("» no existing authentication headers to remove");
  }

  // non-PR events: set up origin with token, stay on default branch
  if (params.payload.event.is_pr !== true || !params.payload.event.issue_number) {
    const originUrl = `https://x-access-token:${params.token}@github.com/${params.owner}/${params.name}.git`;
    $("git", ["remote", "set-url", "origin", originUrl], { cwd: repoDir });
    log.info("» updated origin URL with authentication token");
    return;
  }

  // PR event: checkout PR branch using shared helper
  const prNumber = params.payload.event.issue_number;

  // ensure origin is configured with auth token before checkout
  const originUrl = `https://x-access-token:${params.token}@github.com/${params.owner}/${params.name}.git`;
  $("git", ["remote", "set-url", "origin", originUrl], { cwd: repoDir });

  // use shared checkout helper (handles fork remotes, push config, etc.)
  const prContext = await checkoutPrBranch({
    octokit: params.octokit,
    owner: params.owner,
    name: params.name,
    token: params.token,
    pullNumber: prNumber,
  });

  // set prNumber on toolState (the only mutation)
  params.toolState.prNumber = prContext.prNumber;
}
