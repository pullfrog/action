import type { AgentName } from "../external.ts";
import { log } from "./cli.ts";
import type { RepoContext } from "./github.ts";

export interface Mode {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface RepoSettings {
  defaultAgent: AgentName | null;
  webAccessLevel: "full_access" | "limited";
  webAccessAllowTrusted: boolean;
  webAccessDomains: string;
  modes: Mode[];
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  defaultAgent: null,
  webAccessLevel: "full_access",
  webAccessAllowTrusted: false,
  webAccessDomains: "",
  modes: [],
};

/**
 * Fetch repository settings from the Pullfrog API
 * Returns defaults if repo doesn't exist or fetch fails
 */
export async function fetchRepoSettings({
  token,
  repoContext,
}: {
  token: string;
  repoContext: RepoContext;
}): Promise<RepoSettings> {
  log.info("Fetching repository settings...");
  const settings = await getRepoSettings(token, repoContext);
  log.info("Repository settings fetched");
  return settings;
}

/**
 * Fetch repository settings from the Pullfrog API with fallback to defaults
 * Returns agent, permissions, and workflows (excludes triggers)
 * Returns defaults if repo doesn't exist or fetch fails
 */
export async function getRepoSettings(
  token: string,
  repoContext: RepoContext
): Promise<RepoSettings> {
  const apiUrl = process.env.API_URL || "https://pullfrog.ai";

  // Add timeout to prevent hanging (5 seconds)
  const timeoutMs = 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${apiUrl}/api/repo/${repoContext.owner}/${repoContext.name}/settings`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      // If API returns 404 or other error, fall back to defaults
      return DEFAULT_REPO_SETTINGS;
    }

    const settings = (await response.json()) as RepoSettings | null;

    // If API returns null (repo doesn't exist), return defaults
    if (settings === null) {
      return DEFAULT_REPO_SETTINGS;
    }

    return settings;
  } catch {
    clearTimeout(timeoutId);
    // If fetch fails (network error, timeout, etc.), fall back to defaults
    return DEFAULT_REPO_SETTINGS;
  }
}
