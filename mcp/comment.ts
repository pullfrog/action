import { type } from "arktype";
import type { Payload } from "../external.ts";
import { agentsManifest } from "../external.ts";
import { parseRepoContext } from "../utils/github.ts";
import { contextualize, tool } from "./shared.ts";

const PULLFROG_DIVIDER = "<!-- PULLFROG_DIVIDER_DO_NOT_REMOVE_PLZ -->";

function buildCommentFooter(payload: Payload): string {
  const repoContext = parseRepoContext();
  const runId = process.env.GITHUB_RUN_ID;

  const agentName = payload.agent;
  const agentInfo = agentName ? agentsManifest[agentName] : null;
  const agentDisplayName = agentInfo?.displayName || "Unknown Agent";
  const agentUrl = agentInfo?.url || "https://pullfrog.ai";

  // build workflow run URL: https://github.com/{owner}/{repo}/actions/runs/{runId}
  const workflowRunUrl = runId
    ? `https://github.com/${repoContext.owner}/${repoContext.name}/actions/runs/${runId}`
    : `https://github.com/${repoContext.owner}/${repoContext.name}`;

  return `
${PULLFROG_DIVIDER}
---

<sup>🐸 Triggered by [Pullfrog](https://pullfrog.ai) | 🤖 [${agentDisplayName}](${agentUrl}) | [View workflow run](${workflowRunUrl}) | [𝕏](https://x.com/pullfrogai)</sup>`;
}

function stripExistingFooter(body: string): string {
  const dividerIndex = body.indexOf(PULLFROG_DIVIDER);
  if (dividerIndex === -1) {
    return body;
  }
  return body.substring(0, dividerIndex).trimEnd();
}

function addFooter(body: string, payload: Payload): string {
  const bodyWithoutFooter = stripExistingFooter(body);
  const footer = buildCommentFooter(payload);
  return `${bodyWithoutFooter}${footer}`;
}

export const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

export const CreateCommentTool = tool({
  name: "create_issue_comment",
  description: "Create a comment on a GitHub issue",
  parameters: Comment,
  execute: contextualize(async ({ issueNumber, body }, ctx) => {
    const bodyWithFooter = addFooter(body, ctx.payload);

    const result = await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.name,
      issue_number: issueNumber,
      body: bodyWithFooter,
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
    const bodyWithFooter = addFooter(body, ctx.payload);

    const result = await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: commentId,
      body: bodyWithFooter,
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

    const body = `${intent} <img src="https://pullfrog.ai/party-parrot.gif" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />`;
    const bodyWithFooter = addFooter(body, ctx.payload);

    const result = await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.name,
      issue_number: issueNumber,
      body: bodyWithFooter,
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

    const bodyWithFooter = addFooter(body, ctx.payload);

    const result = await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: workingCommentId,
      body: bodyWithFooter,
    });

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
    };
  }),
});

export const ReplyToReviewComment = type({
  pull_number: type.number.describe("the pull request number"),
  comment_id: type.number.describe("the ID of the review comment to reply to"),
  body: type.string.describe("the reply text explaining how the feedback was addressed"),
});

export const ReplyToReviewCommentTool = tool({
  name: "reply_to_review_comment",
  description:
    "Reply to a PR review comment thread explaining how the feedback was addressed. Use this after addressing each review comment to provide specific context about the changes made.",
  parameters: ReplyToReviewComment,
  execute: contextualize(async ({ pull_number, comment_id, body }, ctx) => {
    const bodyWithFooter = addFooter(body, ctx.payload);

    const result = await ctx.octokit.rest.pulls.createReplyForReviewComment({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
      comment_id,
      body: bodyWithFooter,
    });

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
      in_reply_to_id: result.data.in_reply_to_id,
    };
  }),
});
