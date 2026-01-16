import assert from "node:assert/strict";
import * as core from "@actions/core";
import { log } from "./cli.ts";
import { acquireNewToken } from "./github.ts";

// re-export for get-installation-token action
export { acquireNewToken as acquireInstallationToken };
export { revokeGitHubInstallationToken as revokeInstallationToken };

// store token in memory instead of process.env
let githubInstallationToken: string | undefined;

/**
 * Setup GitHub installation token for the action
 */
export async function resolveInstallationToken() {
  assert(!githubInstallationToken, "GitHub installation token is already set.");
  const acquiredToken = await acquireNewToken();
  core.setSecret(acquiredToken);
  githubInstallationToken = acquiredToken;
  return {
    token: acquiredToken,
    [Symbol.asyncDispose]() {
      githubInstallationToken = undefined;
      return revokeGitHubInstallationToken(acquiredToken);
    },
  };
}

/**
 * Get the GitHub installation token from memory
 */
export function getGitHubInstallationToken(): string {
  assert(
    githubInstallationToken,
    "GitHub installation token not set. Call resolveInstallationToken first."
  );
  return githubInstallationToken;
}

export async function revokeGitHubInstallationToken(token: string): Promise<void> {
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";

  try {
    await fetch(`${apiUrl}/installation/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    log.debug("» installation token revoked");
  } catch (error) {
    log.warning(
      `Failed to revoke installation token: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
