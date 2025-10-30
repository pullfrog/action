import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export const PullRequestInfoTool = tool({
  name: "get_pull_request",
  description: "Retrieve detailed information for a specific pull request by number, with a suggested local diff command.",
  parameters: PullRequestInfo,
  execute: contextualize(async ({ pull_number }, ctx) => {
    const pr = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    const data = pr.data;

    const baseBranch = data.base?.ref;
    const headBranch = data.head?.ref;
    const headSha = data.head?.sha;

    // Suggest a local diff command similar to claude-code-action
    // Consumers can run this in a repo checkout to view the diff without API diff access
    const diff_hint = baseBranch
      ? `git fetch origin ${baseBranch} --depth=20 && git diff origin/${baseBranch}...${headSha || "HEAD"}`
      : undefined;

    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      mergeable: data.mergeable,
      user: data.user?.login,
      created_at: data.created_at,
      updated_at: data.updated_at,
      head: headBranch,
      head_sha: headSha,
      base: baseBranch,
      base_sha: data.base?.sha,
      additions: data.additions,
      deletions: data.deletions,
      changed_files: data.changed_files,
      labels: (data.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean),
      requested_reviewers: (data.requested_reviewers || []).map((u) => u.login),
      requested_teams: (data.requested_teams || []).map((t) => t.slug),
      diff_hint,
    };
  }),
});
