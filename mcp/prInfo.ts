import { execSync } from "node:child_process";
import { type } from "arktype";
import { log } from "../utils/cli.ts";
import { contextualize, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export const PullRequestInfoTool = tool({
  name: "get_pull_request",
  description:
    "Retrieve PR information and automatically prepare the repository for review by fetching and checking out the PR branch.",
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

    // Automatically fetch and checkout branches for review
    log.info(`Fetching base branch: origin/${baseBranch}`);
    execSync(`git fetch origin ${baseBranch} --depth=20`, { stdio: "inherit" });

    log.info(`Fetching PR branch: origin/${headBranch}`);
    execSync(`git fetch origin ${headBranch}`, { stdio: "inherit" });

    log.info(`Checking out PR branch: origin/${headBranch}`);
    execSync(`git checkout origin/${headBranch}`, { stdio: "inherit" });

    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      base: baseBranch,
      head: headBranch,
    };
  }),
});
