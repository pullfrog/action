import type { AgentName, BashPermission, ToolPermission } from "../external.ts";
import type { RepoContext } from "./github.ts";

export interface Mode {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface RepoSettings {
  defaultAgent: AgentName | null;
  web: ToolPermission;
  search: ToolPermission;
  write: ToolPermission;
  bash: BashPermission;
  modes: Mode[];
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  defaultAgent: null,
  web: "enabled",
  search: "enabled",
  write: "enabled",
  bash: "restricted",
  modes: [],
};

/**
 * Fetch repository settings from the Pullfrog API
 * Returns defaults if repo doesn't exist or fetch fails
 */
export async function fetchRepoSettings(params: {
  token: string;
  repoContext: RepoContext;
}): Promise<RepoSettings> {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${apiUrl}/api/repo/${params.repoContext.owner}/${params.repoContext.name}/settings`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return DEFAULT_REPO_SETTINGS;
    }

    const settings = (await response.json()) as RepoSettings | null;
    if (settings === null) {
      return DEFAULT_REPO_SETTINGS;
    }

    return settings;
  } catch {
    clearTimeout(timeoutId);
    return DEFAULT_REPO_SETTINGS;
  }
}
