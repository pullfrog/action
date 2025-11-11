import type { RepoContext } from "./github.ts";

export interface RepoSettings {
  defaultAgent: string | null;
  webAccessLevel: "full_access" | "limited";
  webAccessAllowTrusted: boolean;
  webAccessDomains: string;
  workflows: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
  }>;
}

const DEFAULT_REPO_SETTINGS: RepoSettings = {
  defaultAgent: null,
  webAccessLevel: "full_access",
  webAccessAllowTrusted: false,
  webAccessDomains: "",
  workflows: [],
};

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

  try {
    const response = await fetch(
      `${apiUrl}/api/repo/${repoContext.owner}/${repoContext.name}/settings`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

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
    // If fetch fails (network error, etc.), fall back to defaults
    return DEFAULT_REPO_SETTINGS;
  }
}
