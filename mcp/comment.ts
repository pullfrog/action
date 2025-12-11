import { Octokit } from "@octokit/rest";
import { type } from "arktype";
import type { Payload } from "../external.ts";
import { agentsManifest } from "../external.ts";
import { fetchWorkflowRunInfo } from "../utils/api.ts";
import { getGitHubInstallationToken, parseRepoContext } from "../utils/github.ts";
import { contextualize, getMcpContext, tool } from "./shared.ts";

const PULLFROG_DIVIDER = "<!-- PULLFROG_DIVIDER_DO_NOT_REMOVE_PLZ -->";

/**
 * The prefix text for the initial "leaping into action" comment.
 * This is used to identify if a comment is still in its initial state
 * and hasn't been updated with progress or error messages.
 */
export const LEAPING_INTO_ACTION_PREFIX = "Leaping into action";

function buildCommentFooter(payload: Payload): string {
  const repoContext = parseRepoContext();
  const runId = process.env.GITHUB_RUN_ID;

  const agentName = payload.agent;
  const agentInfo = agentName ? agentsManifest[agentName] : null;
  const agentDisplayName = agentInfo?.displayName || "Unknown agent";
  const agentUrl = agentInfo?.url || "https://pullfrog.com";

  // build workflow run link or show unavailable message
  const workflowRunPart = runId
    ? `[View workflow run](https://github.com/${repoContext.owner}/${repoContext.name}/actions/runs/${runId})`
    : "View workflow run";

  return `
${PULLFROG_DIVIDER}
<sup><a href="https://pullfrog.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://pullfrog.com/logos/frog-white-full-128px.png"><img src="https://pullfrog.com/logos/frog-green-full-128px.png" width="9px" height="9px" style="vertical-align: middle; " alt="Pullfrog"></picture></a>&nbsp;&nbsp;｜ Triggered by [Pullfrog](https://pullfrog.com) ｜ Using [${agentDisplayName}](${agentUrl}) ｜ ${workflowRunPart} ｜ [𝕏](https://x.com/pullfrogai)</sup>`;
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

// track whether the progress comment was updated during execution
let progressCommentWasUpdated = false;

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

/**
 * Standalone function to report progress to GitHub comment.
 * Can be called directly without going through the MCP tool interface.
 * Returns result data if successful, undefined if comment cannot be created.
 */
export async function reportProgress({ body }: { body: string }): Promise<
  | {
      commentId: number;
      url: string;
      body: string;
      action: "created" | "updated";
    }
  | undefined
> {
  const ctx = getMcpContext();

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

    progressCommentWasUpdated = true;

    return {
      commentId: result.data.id,
      url: result.data.html_url,
      body: result.data.body || "",
      action: "updated",
    };
  }

  // no existing comment - create one
  const issueNumber = ctx.payload.event.issue_number;
  if (issueNumber === undefined) {
    throw new Error("cannot create progress comment: no issue_number found in the payload event");
  }

  const result = await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.name,
    issue_number: issueNumber,
    body: bodyWithFooter,
  });

  // store the comment ID for future updates
  setProgressCommentId(result.data.id);
  progressCommentWasUpdated = true;

  return {
    commentId: result.data.id,
    url: result.data.html_url,
    body: result.data.body || "",
    action: "created",
  };
}

export const ReportProgressTool = tool({
  name: "report_progress",
  description:
    "Share progress on the associated GitHub issue/PR. Call this to post updates as you work. The first call creates a comment, subsequent calls update it. Use this throughout your work to keep stakeholders informed.",
  parameters: ReportProgress,
  execute: contextualize(async ({ body }) => {
    const result = await reportProgress({ body });

    return {
      success: true,
      ...result,
    };
  }),
});

/**
 * Check if the progress comment was updated during execution
 */
export function wasProgressCommentUpdated(): boolean {
  return progressCommentWasUpdated;
}

/**
 * Ensure the progress comment is updated with a generic error message if it was never updated.
 * This should be called after agent execution completes to handle cases where the agent
 * exited without ever calling reportProgress.
 *
 * Works even if MCP context is not initialized (e.g., if error occurs before MCP server starts).
 * Will fetch comment ID from database if not available in environment variable.
 */
export async function ensureProgressCommentUpdated(payload?: Payload): Promise<void> {
  // skip if comment was already updated during execution
  if (progressCommentWasUpdated) {
    return;
  }

  // try to get comment ID from env var first, then from database if needed
  let existingCommentId = getProgressCommentId();

  // if not in env var, try fetching from database using run ID
  if (!existingCommentId) {
    const runId = process.env.GITHUB_RUN_ID;
    if (runId) {
      try {
        const workflowRunInfo = await fetchWorkflowRunInfo(runId);
        if (workflowRunInfo.progressCommentId) {
          existingCommentId = parseInt(workflowRunInfo.progressCommentId, 10);
          // cache it in env var for future use
          if (!Number.isNaN(existingCommentId)) {
            process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
          }
        }
      } catch {
        // database fetch failed, continue without comment ID
      }
    }
  }

  // if still no comment ID, nothing to update
  if (!existingCommentId) {
    return;
  }

  // check if comment still says "leaping into action" - if it's been updated with an error, don't overwrite it
  const repoContext = parseRepoContext();
  const token = getGitHubInstallationToken();
  const octokit = new Octokit({ auth: token });

  try {
    const existingComment = await octokit.rest.issues.getComment({
      owner: repoContext.owner,
      repo: repoContext.name,
      comment_id: existingCommentId,
    });

    const commentBody = existingComment.data.body || "";
    // if comment doesn't start with the leaping prefix, it's already been updated with an error or progress
    if (!commentBody.startsWith(LEAPING_INTO_ACTION_PREFIX)) {
      return;
    }
  } catch {
    // can't fetch comment, skip update
    return;
  }

  // try to get payload from MCP context if available, otherwise use provided payload
  let resolvedPayload: Payload | undefined;
  try {
    const ctx = getMcpContext();
    resolvedPayload = ctx.payload;
  } catch {
    // MCP context not initialized, use provided payload
    resolvedPayload = payload;
  }

  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunLink = runId
    ? `[workflow](https://github.com/${repoContext.owner}/${repoContext.name}/actions/runs/${runId})`
    : "workflow";

  const errorMessage = `❌ this run croaked

The workflow encountered an error before any progress could be reported. Please check the ${workflowRunLink} for details.`;

  // add footer if we have payload, otherwise use plain message
  const body = resolvedPayload ? addFooter(errorMessage, resolvedPayload) : errorMessage;

  await octokit.rest.issues.updateComment({
    owner: repoContext.owner,
    repo: repoContext.name,
    comment_id: existingCommentId,
    body,
  });
}

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
