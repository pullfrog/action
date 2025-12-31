import { Octokit } from "@octokit/rest";
import { type } from "arktype";
import type { Payload } from "../external.ts";
import { agentsManifest } from "../external.ts";
import type { ToolContext } from "../main.ts";
import { fetchWorkflowRunInfo } from "../utils/api.ts";
import { buildPullfrogFooter, stripExistingFooter } from "../utils/buildPullfrogFooter.ts";
import { getGitHubInstallationToken, parseRepoContext } from "../utils/github.ts";
import { execute, tool } from "./shared.ts";

/**
 * The prefix text for the initial "leaping into action" comment.
 * This is used to identify if a comment is still in its initial state
 * and hasn't been updated with progress or error messages.
 */
export const LEAPING_INTO_ACTION_PREFIX = "Leaping into action";

interface BuildCommentFooterParams {
  payload: Payload;
  octokit?: Octokit | undefined;
  customParts?: string[] | undefined;
}

async function buildCommentFooter({
  payload,
  octokit,
  customParts,
}: BuildCommentFooterParams): Promise<string> {
  const repoContext = parseRepoContext();
  const runId = process.env.GITHUB_RUN_ID;

  const agentName = payload.agent;
  const agentInfo = agentName ? agentsManifest[agentName] : null;

  let workflowRunHtmlUrl: string | undefined;
  if (runId && octokit) {
    try {
      // fetch jobs to get the job URL for deep linking
      const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
        owner: repoContext.owner,
        repo: repoContext.name,
        run_id: parseInt(runId, 10),
      });
      // use the first job's URL if available
      workflowRunHtmlUrl = jobs.jobs[0]?.html_url ?? undefined;
    } catch {
      // fall back to building URL from runId if jobs can't be fetched
    }
  }

  const footerParams = {
    triggeredBy: true,
    agent: {
      displayName: agentInfo?.displayName || "Unknown agent",
      url: agentInfo?.url || "https://pullfrog.com",
    },
    workflowRun: runId
      ? {
          owner: repoContext.owner,
          repo: repoContext.name,
          runId,
          ...(workflowRunHtmlUrl ? { htmlUrl: workflowRunHtmlUrl } : {}),
        }
      : undefined,
  };

  if (customParts && customParts.length > 0) {
    return buildPullfrogFooter({ ...footerParams, customParts });
  }
  return buildPullfrogFooter(footerParams);
}

function buildImplementPlanLink(
  owner: string,
  repo: string,
  issueNumber: number,
  commentId: number
): string {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  return `[Implement plan ➔](${apiUrl}/trigger/${owner}/${repo}/${issueNumber}?action=implement&comment_id=${commentId})`;
}

async function addFooter(body: string, payload: Payload, octokit?: Octokit): Promise<string> {
  const bodyWithoutFooter = stripExistingFooter(body);
  const footer = await buildCommentFooter({ payload, octokit });
  return `${bodyWithoutFooter}${footer}`;
}

export const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

export function CreateCommentTool(ctx: ToolContext) {
  return tool({
    name: "create_issue_comment",
    description:
      "Create a comment on a GitHub issue. NOTE: Do NOT use this for progress updates or status summaries - use report_progress instead, which updates the existing progress comment.",
    parameters: Comment,
    execute: execute(async ({ issueNumber, body }) => {
      const bodyWithFooter = await addFooter(body, ctx.payload, ctx.octokit);

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
}

export const EditComment = type({
  commentId: type.number.describe("the ID of the comment to edit"),
  body: type.string.describe("the new comment body content"),
});

export function EditCommentTool(ctx: ToolContext) {
  return tool({
    name: "edit_issue_comment",
    description: "Edit a GitHub issue comment by its ID",
    parameters: EditComment,
    execute: execute(async ({ commentId, body }) => {
      const bodyWithFooter = await addFooter(body, ctx.payload, ctx.octokit);

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
}

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
export async function reportProgress(
  ctx: ToolContext,
  { body }: { body: string }
): Promise<
  | {
      commentId: number;
      url: string;
      body: string;
      action: "created" | "updated";
    }
  | undefined
> {
  const existingCommentId = getProgressCommentId();
  const issueNumber =
    ctx.toolState.prNumber ?? ctx.toolState.issueNumber ?? ctx.payload.event.issue_number;
  const isPlanMode = ctx.toolState.selectedMode === "Plan";

  // if we already have a progress comment, update it
  if (existingCommentId) {
    const customParts =
      isPlanMode && issueNumber !== undefined
        ? [buildImplementPlanLink(ctx.owner, ctx.name, issueNumber, existingCommentId)]
        : undefined;

    const bodyWithoutFooter = stripExistingFooter(body);
    const footer = await buildCommentFooter({
      payload: ctx.payload,
      octokit: ctx.octokit,
      customParts,
    });
    const bodyWithFooter = `${bodyWithoutFooter}${footer}`;

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
  // use fallback chain: dynamically set context > event payload
  if (issueNumber === undefined) {
    // cannot create comment without issue_number (e.g., workflow_dispatch events)
    return undefined;
  }

  // for new comments, we need to create first, then update with Plan link if in Plan mode
  const initialBody = await addFooter(body, ctx.payload, ctx.octokit);

  const result = await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.name,
    issue_number: issueNumber,
    body: initialBody,
  });

  // store the comment ID for future updates
  setProgressCommentId(result.data.id);
  progressCommentWasUpdated = true;

  // if Plan mode, update the comment to add the "Implement plan" link
  if (isPlanMode) {
    const customParts = [buildImplementPlanLink(ctx.owner, ctx.name, issueNumber, result.data.id)];
    const bodyWithoutFooter = stripExistingFooter(body);
    const footer = await buildCommentFooter({
      payload: ctx.payload,
      octokit: ctx.octokit,
      customParts,
    });
    const bodyWithPlanLink = `${bodyWithoutFooter}${footer}`;

    const updateResult = await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: result.data.id,
      body: bodyWithPlanLink,
    });

    return {
      commentId: updateResult.data.id,
      url: updateResult.data.html_url,
      body: updateResult.data.body || "",
      action: "created",
    };
  }

  return {
    commentId: result.data.id,
    url: result.data.html_url,
    body: result.data.body || "",
    action: "created",
  };
}

export function ReportProgressTool(ctx: ToolContext) {
  return tool({
    name: "report_progress",
    description:
      "Share progress on the associated GitHub issue/PR. Call this to post updates as you work. The first call creates a comment, subsequent calls update it. Use this throughout your work to keep stakeholders informed.",
    parameters: ReportProgress,
    execute: execute(async ({ body }) => {
      const result = await reportProgress(ctx, { body });

      if (!result) {
        // gracefully handle case where no comment can be created
        // this happens for workflow_dispatch events or when there's no associated issue/PR
        return {
          success: false,
          message:
            "cannot create progress comment: no issue_number found in the payload event. this may occur for workflow_dispatch events or when there is no associated issue/PR. if you need to comment on a specific issue or PR, use create_issue_comment with an explicit issueNumber.",
        };
      }

      return {
        success: true,
        ...result,
      };
    }),
  });
}

/**
 * Check if the progress comment was updated during execution
 */
export function wasProgressCommentUpdated(): boolean {
  return progressCommentWasUpdated;
}

/**
 * Delete the progress comment if it exists.
 * Used after submitting a PR review since the review body contains all necessary info.
 */
export async function deleteProgressComment(ctx: ToolContext): Promise<boolean> {
  const existingCommentId = getProgressCommentId();
  if (!existingCommentId) {
    return false;
  }

  try {
    await ctx.octokit.rest.issues.deleteComment({
      owner: ctx.owner,
      repo: ctx.name,
      comment_id: existingCommentId,
    });
  } catch (error) {
    // ignore 404 - comment already deleted
    if (error instanceof Error && error.message.includes("Not Found")) {
      // comment already deleted, continue
    } else {
      throw error;
    }
  }

  // reset state but mark as "updated" so ensureProgressCommentUpdated doesn't try to handle it
  progressCommentId = null;
  progressCommentIdInitialized = true; // keep initialized so we don't re-fetch from env
  progressCommentWasUpdated = true; // mark as handled so ensureProgressCommentUpdated skips

  return true;
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

  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunLink = runId
    ? `[workflow run logs](https://github.com/${repoContext.owner}/${repoContext.name}/actions/runs/${runId})`
    : "workflow run logs";

  const errorMessage = `This run croaked 😵

The workflow encountered an error before any progress could be reported. Please check the ${workflowRunLink} for details.`;

  // add footer if we have payload, otherwise use plain message
  const body = payload ? await addFooter(errorMessage, payload, octokit) : errorMessage;

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
  body: type.string.describe(
    "extremely brief reply (1 sentence max) explaining what was fixed, e.g. 'Fixed by renaming to X' or 'Added null check'"
  ),
});

export function ReplyToReviewCommentTool(ctx: ToolContext) {
  return tool({
    name: "reply_to_review_comment",
    description:
      "Reply to a PR review comment thread. Call this for EACH comment you address. Keep replies extremely brief (1 sentence max).",
    parameters: ReplyToReviewComment,
    execute: execute(async ({ pull_number, comment_id, body }) => {
      const bodyWithFooter = await addFooter(body, ctx.payload, ctx.octokit);

      const result = await ctx.octokit.rest.pulls.createReplyForReviewComment({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
        comment_id,
        body: bodyWithFooter,
      });

      // mark progress as updated so ensureProgressCommentUpdated doesn't think the run failed
      progressCommentWasUpdated = true;

      return {
        success: true,
        commentId: result.data.id,
        url: result.data.html_url,
        body: result.data.body,
        in_reply_to_id: result.data.in_reply_to_id,
      };
    }),
  });
}
