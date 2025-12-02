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

  // build workflow run link or show unavailable message
  const workflowRunPart = runId
    ? `[View workflow run](https://github.com/${repoContext.owner}/${repoContext.name}/actions/runs/${runId})`
    : "(workflow link unavailable)";

  return `
${PULLFROG_DIVIDER}
---

<sup>🐸 Triggered by [Pullfrog](https://pullfrog.ai) | 🤖 [${agentDisplayName}](${agentUrl}) | ${workflowRunPart} | [𝕏](https://x.com/pullfrogai)</sup>`;
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

/**
 * Get progress comment ID from environment variable.
 * This allows the webhook handler to pre-create a "leaping into action" comment
 * and pass the ID to the action for updates.
 */
function getProgressCommentIdFromEnv(): number | null {
  const envCommentId = process.env.PULLFROG_PROGRESS_COMMENT_ID;
  if (envCommentId) {
    const parsed = parseInt(envCommentId, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

// module-level variable to track the progress comment ID
// initialized lazily on first use to allow env var to be set after module load
let progressCommentId: number | null = null;
let progressCommentIdInitialized = false;

function getProgressCommentId(): number | null {
  if (!progressCommentIdInitialized) {
    progressCommentId = getProgressCommentIdFromEnv();
    progressCommentIdInitialized = true;
  }
  return progressCommentId;
}

function setProgressCommentId(id: number): void {
  progressCommentId = id;
  progressCommentIdInitialized = true;
}

export const ReportProgress = type({
  body: type.string.describe("the progress update content to share"),
});

export const ReportProgressTool = tool({
  name: "report_progress",
  description:
    "Share progress on the associated GitHub issue/PR. Call this to post updates as you work. The first call creates a comment, subsequent calls update it. Use this throughout your work to keep stakeholders informed.",
  parameters: ReportProgress,
  execute: contextualize(async ({ body }, ctx) => {
    const bodyWithFooter = addFooter(body, ctx.payload);
    const existingCommentId = getProgressCommentId();

    // if we already have a progress comment, update it
    if (existingCommentId) {
      const result = await ctx.octokit.rest.issues.updateComment({
        owner: ctx.owner,
        repo: ctx.name,
        comment_id: existingCommentId,
        body: bodyWithFooter,
      });

      return {
        success: true,
        commentId: result.data.id,
        url: result.data.html_url,
        body: result.data.body,
        action: "updated",
      };
    }

    // no existing comment - create one
    const issueNumber = ctx.payload.event.issue_number;
    if (issueNumber === undefined) {
      throw new Error(
        "cannot create progress comment: no issue_number found in the payload event"
      );
    }

    const result = await ctx.octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.name,
      issue_number: issueNumber,
      body: bodyWithFooter,
    });

    // store the comment ID for future updates
    setProgressCommentId(result.data.id);

    return {
      success: true,
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body,
      action: "created",
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
