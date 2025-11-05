import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

export const CreateCommentTool = tool({
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

export const EditComment = type({
  commentId: type.number.describe("the ID of the comment to edit"),
  body: type.string.describe("the new comment body content"),
});

export const EditCommentTool = tool({
  name: "edit_issue_comment",
  description: "Edit a GitHub issue comment by its ID",
  parameters: EditComment,
  execute: contextualize(async ({ commentId, body }, ctx) => {
    const result = await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: commentId,
      body: body,
    });

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
      updatedAt: result.data.updated_at,
    };
  }),
});
