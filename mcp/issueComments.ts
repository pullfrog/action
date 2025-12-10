import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const GetIssueComments = type({
  issue_number: type.number.describe("The issue number to get comments for"),
});

export const GetIssueCommentsTool = tool({
  name: "get_issue_comments",
  description:
    "Get all comments for a GitHub issue. Returns all comments including the issue body and all subsequent discussion comments.",
  parameters: GetIssueComments,
  execute: contextualize(async ({ issue_number }, ctx) => {
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
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
        author_association: comment.author_association,
        reactions: comment.reactions,
      })),
      count: comments.length,
    };
  }),
});
