/**
 * token acquisition and revocation for get-installation-token action.
 * reuses the existing github.ts utilities.
 */

import { acquireNewToken, revokeGitHubInstallationToken } from "../utils/github.ts";

export async function acquireInstallationToken(opts?: { repos?: string[] }): Promise<string> {
  return acquireNewToken(opts);
}

export async function revokeInstallationToken(token: string): Promise<void> {
  return revokeGitHubInstallationToken(token);
}
