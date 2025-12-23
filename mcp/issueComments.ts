import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { execute, tool } from "./shared.ts";

export const GetIssueComments = type({
  issue_number: type.number.describe("The issue number to get comments for"),
});

export function GetIssueCommentsTool(ctx: ToolContext) {
  return tool({
    name: "get_issue_comments",
    description:
      "Get all comments for a GitHub issue. Returns all comments including the issue body and all subsequent discussion comments.",
    parameters: GetIssueComments,
    execute: execute(async ({ issue_number }) => {
      // set issue context
      ctx.toolState.issueNumber = issue_number;

      const comments = await ctx.octokit.paginate(ctx.octokit.rest.issues.listComments, {
        owner: ctx.owner,
        repo: ctx.name,
        issue_number,
      });

      return {
        issue_number,
        comments: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          user: comment.user?.login,
          author_association: comment.author_association,
        })),
        count: comments.length,
      };
    }),
  });
}
