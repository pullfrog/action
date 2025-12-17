import { type } from "arktype";
import type { Context } from "../main.ts";
import { execute, tool } from "./shared.ts";

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export function PullRequestInfoTool(ctx: Context) {
  return tool({
    name: "get_pull_request",
    description:
      "Retrieve PR metadata (number, title, state, base/head branches, fork status). To checkout a PR branch locally, use checkout_pr instead.",
    parameters: PullRequestInfo,
    execute: execute(ctx, async ({ pull_number }) => {
      const pr = await ctx.octokit.rest.pulls.get({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
      });

      const data = pr.data;

      // detect fork PRs - head repo differs from base repo (head.repo can be null if fork was deleted)
      const isFork = data.head.repo?.full_name !== data.base.repo.full_name;

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
}
