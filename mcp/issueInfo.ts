import { type } from "arktype";
import type { Context } from "../main.ts";
import { execute, tool } from "./shared.ts";

export const IssueInfo = type({
  issue_number: type.number.describe("The issue number to fetch"),
});

export function IssueInfoTool(ctx: Context) {
  return tool({
    name: "get_issue",
    description: "Retrieve GitHub issue information by issue number",
    parameters: IssueInfo,
    execute: execute(ctx, async ({ issue_number }) => {
      const issue = await ctx.octokit.rest.issues.get({
        owner: ctx.owner,
        repo: ctx.name,
        issue_number,
      });

      const data = issue.data;

      const hints: string[] = [];
      if (data.comments > 0) {
        hints.push("use get_issue_comments to retrieve all comments for this issue");
      }
      hints.push(
        "use get_issue_events to retrieve cross-references and commit references (relationships not reflected in current state)"
      );

      return {
        number: data.number,
        url: data.html_url,
        title: data.title,
        body: data.body,
        state: data.state,
        locked: data.locked,
        labels: data.labels?.map((label) => (typeof label === "string" ? label : label.name)),
        assignees: data.assignees?.map((assignee) => assignee.login),
        user: data.user?.login,
        created_at: data.created_at,
        updated_at: data.updated_at,
        closed_at: data.closed_at,
        comments: data.comments,
        milestone: data.milestone?.title,
        pull_request: data.pull_request
          ? {
              url: data.pull_request.url,
              html_url: data.pull_request.html_url,
              diff_url: data.pull_request.diff_url,
              patch_url: data.pull_request.patch_url,
            }
          : null,
        hints,
      };
    }),
  });
}
