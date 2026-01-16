import type { Octokit } from "@octokit/rest";
import packageJson from "../package.json" with { type: "json" };
import { log } from "./cli.ts";
import { createOctokit, type OctokitWithPlugins, parseRepoContext } from "./github.ts";
import { fetchRepoSettings, type RepoSettings } from "./repoSettings.ts";

export interface RepoData {
  owner: string;
  name: string;
  repo: Awaited<ReturnType<Octokit["repos"]["get"]>>["data"];
  repoSettings: RepoSettings;
}

interface ResolveRepoDataParams {
  octokit: OctokitWithPlugins;
  token: string;
}

/**
 * Initialize repo data: parse context, fetch repo info and settings
 */
export async function resolveRepoData(params: ResolveRepoDataParams): Promise<RepoData> {
  log.info(`» running Pullfrog v${packageJson.version}...`);

  const { owner, name } = parseRepoContext();

  // fetch repo data and settings in parallel
  const [repoResponse, repoSettings] = await Promise.all([
    params.octokit.repos.get({ owner, repo: name }),
    fetchRepoSettings({ token: params.token, repoContext: { owner, name } }),
  ]);

  return {
    owner,
    name,
    repo: repoResponse.data,
    repoSettings,
  };
}

// re-export for convenience
export { createOctokit };
