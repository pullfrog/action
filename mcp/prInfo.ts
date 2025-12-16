import { type } from "arktype";
import { log } from "../utils/cli.ts";
import { $ } from "../utils/shell.ts";
import { contextualize, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export const PullRequestInfoTool = tool({
  name: "get_pull_request",
  description: "Retrieve PR information. Automatically fetches and checks out the PR branch.",
  parameters: PullRequestInfo,
  execute: contextualize(async ({ pull_number }, ctx) => {
    const pr = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    const data = pr.data;

    const baseBranch = data.base.ref;
    const headBranch = data.head.ref;

    if (!baseBranch) {
      throw new Error(`Base branch not found for PR #${pull_number}`);
    }

    // detect fork PRs - head repo differs from base repo
    const baseRepo = data.base.repo.full_name;
    const headRepo = data.head.repo.full_name;
    const isFork = headRepo !== baseRepo;

    // use gh pr checkout which handles fork PRs automatically
    // it adds the fork as a remote if needed and checks out the PR branch
    log.info(`Checking out PR #${pull_number} using gh pr checkout`);
    $("gh", ["pr", "checkout", pull_number.toString()]);

    // fetch base branch for diff comparison
    log.info(`Fetching base branch: origin/${baseBranch}`);
    $("git", ["fetch", "origin", baseBranch, "--depth=20"]);

    // get current git status for summary
    const currentBranch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false }).trim();
    const currentSha = $("git", ["rev-parse", "HEAD"], { log: false }).trim();
    const baseSha = $("git", ["rev-parse", `origin/${baseBranch}`], { log: false }).trim();

    // build summary
    const summary = `PR branch has been fetched and checked out:
- Base branch: \`origin/${baseBranch}\` (${baseSha.substring(0, 7)})
- PR branch: \`${headBranch}\` (checked out locally, ${currentSha.substring(0, 7)})
- Current branch: \`${currentBranch}\`
- View diff: \`git diff origin/${baseBranch}...HEAD\``;

    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      base: baseBranch,
      head: headBranch,
      isFork,
      summary,
    };
  }),
});
