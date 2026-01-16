import type { Octokit } from "@octokit/rest";
import packageJson from "../package.json" with { type: "json" };
import { log } from "./cli.ts";
import { createOctokit, parseRepoContext } from "./github.ts";
import { fetchRepoSettings, type RepoSettings } from "./repoSettings.ts";

export interface RepoData {
  owner: string;
  name: string;
  octokit: Octokit;
  repo: Awaited<ReturnType<Octokit["repos"]["get"]>>["data"];
  repoSettings: RepoSettings;
}

/**
 * Initialize GitHub connection: token, octokit, repo data, settings
 */
export async function resolveRepoData(token: string): Promise<RepoData> {
  log.info(`» running Pullfrog v${packageJson.version}...`);

  const { owner, name } = parseRepoContext();

  const octokit = createOctokit(token);

  // fetch repo data and settings in parallel
  const [repoResponse, repoSettings] = await Promise.all([
    octokit.repos.get({ owner, repo: name }),
    fetchRepoSettings({ token, repoContext: { owner, name } }),
  ]);

  return {
    owner,
    name,
    octokit,
    repo: repoResponse.data,
    repoSettings,
  };
}
