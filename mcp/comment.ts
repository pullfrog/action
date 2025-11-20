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

let workingCommentId: number | null = null;

export const WorkingComment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  intent: type("/^I'll .+$/").describe(
    "the body of the initial comment expressing your intent to handle the request. must have the form 'I'll {summary of request}'"
  ),
});

export const CreateWorkingCommentTool = tool({
  name: "create_working_comment",
  description:
    "Create an initial comment on a GitHub issue that will be updated as work progresses",
  parameters: WorkingComment,
  execute: contextualize(async ({ issueNumber, intent }, ctx) => {
    if (workingCommentId) {
      throw new Error("create_working_comment may not be called multiple times");
    }

    const result = await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.name,
      issue_number: issueNumber,
      body: `${intent} <img src="https://pullfrog.ai/party-parrot.gif" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />`,
    });

    workingCommentId = result.data.id;

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
    };
  }),
});

export const WorkingCommentUpdate = type({
  body: type.string.describe("the new comment body content"),
});

export const UpdateWorkingCommentTool = tool({
  name: "update_working_comment",
  description: "Update a working comment on a GitHub issue",
  parameters: WorkingCommentUpdate,
  execute: contextualize(async ({ body }, ctx) => {
    if (!workingCommentId) {
      throw new Error("create_working_comment must be called before update_working_comment");
    }

    const result = await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: workingCommentId,
      body,
    });

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
    };
  }),
});
