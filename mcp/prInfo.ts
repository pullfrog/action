import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export const PullRequestInfoTool = tool({
  name: "get_pull_request",
  description:
    "Retrieve PR information (metadata only). PR branch is already checked out during setup.",
  parameters: PullRequestInfo,
  execute: contextualize(async ({ pull_number }, ctx) => {
    const pr = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    const data = pr.data;

    // detect fork PRs - head repo differs from base repo
    const isFork = data.head.repo.full_name !== data.base.repo.full_name;

    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      state: data.state,
      draft: data.draft,
      merged: data.merged,
      base: data.base.ref,
      head: data.head.ref,
      isFork,
    };
  }),
});
