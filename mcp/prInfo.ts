import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export const PullRequestInfoTool = tool({
  name: "get_pull_request",
  description: "Retrieve detailed information and diff for a specific pull request by number.",
  parameters: PullRequestInfo,
  execute: contextualize(async ({ pull_number }, ctx) => {
    const pr = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    // Fetch diff using raw request
    const diff = await ctx.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
      headers: {
        Accept: 'application/vnd.github.v3.diff',
      },
    });

    return {
      ...pr.data,
      diff: diff.data,
    };
  }),
});
