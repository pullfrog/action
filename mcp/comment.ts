import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

export const CommentTool = tool({
  name: "create_issue_comment",
  description: "Create a comment on a GitHub issue",
  parameters: Comment,
  execute: contextualize(async ({ issueNumber, body }, ctx) => {
    const result = await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.name,
      issue_number: issueNumber,
      body: body,
    });

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
    };
  }),
});
