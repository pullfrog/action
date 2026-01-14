import type { RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { buildPullfrogFooter } from "../utils/buildPullfrogFooter.ts";
import { log } from "../utils/cli.ts";
import { deleteProgressComment } from "./comment.ts";
import { execute, tool } from "./shared.ts";

// one-shot review tool
export const CreatePullRequestReview = type({
  pull_number: type.number.describe("The pull request number to review"),
  body: type.string
    .describe(
      "1-2 sentence high-level summary with urgency level, critical callouts, and feedback about code outside the diff. Specific feedback on diff lines goes in 'comments' array."
    )
    .optional(),
  commit_id: type.string
    .describe("Optional SHA of the commit being reviewed. Defaults to latest.")
    .optional(),
  comments: type({
    path: type.string.describe("The file path to comment on (relative to repo root)"),
    line: type.number.describe(
      "Line number from the diff. Each code line shows 'OLD | NEW | TYPE | CODE'. Use the NEW column (second column)."
    ),
    side: type
      .enumerated("LEFT", "RIGHT")
      .describe(
        "Side of the diff: LEFT (old code, lines starting with -) or RIGHT (new code, lines starting with + or unchanged). Defaults to RIGHT."
      )
      .optional(),
    body: type.string.describe(
      "The comment text for this specific line. For issues appearing multiple times, comment on the first occurrence and reference others. When providing code suggestions, use GitHub's suggestion format with ```suggestion blocks to enable one-click apply. Only include explanatory text if the suggested code requires clarification."
    ),
    start_line: type.number
      .describe("Start line for multi-line comments (optional, for commenting on ranges)")
      .optional(),
  })
    .array()
    .describe(
      "Inline comments on lines within diff hunks. Feedback about code outside the diff goes in 'body' instead."
    )
    .optional(),
});

export function CreatePullRequestReviewTool(ctx: ToolContext) {
  return tool({
    name: "create_pull_request_review",
    description:
      "Submit a review for an existing pull request. " +
      "IMPORTANT: 95%+ of feedback should be in 'comments' array with file paths and line numbers. " +
      "Only use 'body' for a 1-2 sentence summary with urgency and critical callouts. " +
      "When suggesting code changes in comments, use GitHub's suggestion format (```suggestion blocks) to enable one-click apply.",
    parameters: CreatePullRequestReview,
    execute: execute(async ({ pull_number, body, commit_id, comments = [] }) => {
      // set PR context
      ctx.toolState.prNumber = pull_number;

      // get the PR to determine the head commit if commit_id not provided
      const pr = await ctx.octokit.rest.pulls.get({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
      });

      // compose the request
      const params: RestEndpointMethodTypes["pulls"]["createReview"]["parameters"] = {
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
        event: "COMMENT",
      };
      if (body) params.body = body;
      if (commit_id) {
        params.commit_id = commit_id;
      } else {
        params.commit_id = pr.data.head.sha;
      }
      if (comments.length > 0) {
        type ReviewComment = (typeof params.comments & {})[number];
        // convert comments to the format expected by GitHub API
        params.comments = comments.map((comment) => {
          const reviewComment: ReviewComment = {
            ...comment,
          };
          reviewComment.side = comment.side || "RIGHT";
          if (comment.start_line) {
            reviewComment.start_line = comment.start_line;
            reviewComment.start_side = comment.side || "RIGHT";
          }
          return reviewComment;
        });
      }
      const result = await ctx.octokit.rest.pulls.createReview(params);
      log.debug(`createReview response: ${JSON.stringify(result.data)}`);
      if (!result.data.id) {
        throw new Error(`createReview returned invalid data: ${JSON.stringify(result.data)}`);
      }
      const reviewId = result.data.id;

      // build quick links footer and update the review body
      const apiUrl = process.env.API_URL || "https://pullfrog.com";
      const fixAllUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${pull_number}?action=fix&review_id=${reviewId}`;
      const fixApprovedUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${pull_number}?action=fix-approved&review_id=${reviewId}`;

      const footer = buildPullfrogFooter({
        workflowRun: { owner: ctx.owner, repo: ctx.name, runId: ctx.runId, jobId: ctx.jobId },
        customParts: [`[Fix all ➔](${fixAllUrl})`, `[Fix 👍s ➔](${fixApprovedUrl})`],
      });

      const updatedBody = (body || "") + footer;

      // update the review with the footer
      await ctx.octokit.rest.pulls.updateReview({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
        review_id: reviewId,
        body: updatedBody,
      });

      await deleteProgressComment(ctx);

      return {
        success: true,
        reviewId,
        html_url: result.data.html_url,
        state: result.data.state,
        user: result.data.user?.login,
        submitted_at: result.data.submitted_at,
      };
    }),
  });
}

// =============================================================================
// COMMENTED OUT: Three-step review flow (start_review, add_review_comment, submit_review)
// This approach used GraphQL to add comments to a pending review one-by-one,
// but GitHub's API was returning null for valid lines. Keeping for reference.
// =============================================================================

/*
// graphql mutation to add a comment thread to a pending review
// note: REST API doesn't support adding comments to an existing pending review
const ADD_PULL_REQUEST_REVIEW_THREAD = `
mutation AddPullRequestReviewThread($pullRequestReviewId: ID!, $path: String!, $line: Int!, $body: String!, $side: DiffSide, $subjectType: PullRequestReviewThreadSubjectType) {
  addPullRequestReviewThread(input: {
    pullRequestReviewId: $pullRequestReviewId,
    path: $path,
    line: $line,
    body: $body,
    side: $side,
    subjectType: $subjectType
  }) {
    thread {
      id
    }
  }
}
`;

type AddPullRequestReviewThreadResponse = {
  addPullRequestReviewThread: {
    thread: {
      id: string;
    };
  };
};

// helper to find existing pending review for the authenticated user
async function findPendingReview(
  ctx: ToolContext,
  pull_number: number
): Promise<{ id: number; node_id: string } | null> {
  const reviews = await ctx.octokit.rest.pulls.listReviews({
    owner: ctx.owner,
    repo: ctx.name,
    pull_number,
    per_page: 100,
  });

  // find a PENDING review from our bot
  // note: authenticated user is the GitHub App, reviews show as "pullfrog[bot]"
  const pendingReview = reviews.data.find((r) => r.state === "PENDING");
  if (pendingReview) {
    return { id: pendingReview.id, node_id: pendingReview.node_id };
  }
  return null;
}

// start_review tool
export const StartReview = type({
  pull_number: type.number.describe("The pull request number to review"),
});

export function StartReviewTool(ctx: ToolContext) {
  return tool({
    name: "start_review",
    description:
      "Start a new review session for a pull request. Creates a pending review on GitHub. Must be called before add_review_comment.",
    parameters: StartReview,
    execute: execute(async ({ pull_number }) => {
      // check if review already started in this session
      if (ctx.toolState.review) {
        throw new Error(
          `Review session already in progress. Call submit_review first to finish it.`
        );
      }

      // get the PR to get head commit SHA
      const pr = await ctx.octokit.rest.pulls.get({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
      });

      let reviewId: number;
      let reviewNodeId: string;

      // try to create a new pending review (omitting 'event' creates PENDING state)
      log.debug(`creating pending review for PR #${pull_number}...`);
      try {
        const result = await ctx.octokit.rest.pulls.createReview({
          owner: ctx.owner,
          repo: ctx.name,
          pull_number,
          commit_id: pr.data.head.sha,
          // no 'event' = PENDING review
        });
        log.debug(`createReview response: ${JSON.stringify(result.data)}`);
        if (!result.data.id || !result.data.node_id) {
          log.debug(result);
          throw new Error(
            `createReview returned invalid data: id=${result.data.id}, node_id=${result.data.node_id}`
          );
        }
        reviewId = result.data.id;
        reviewNodeId = result.data.node_id;
        log.debug(`created new pending review: id=${reviewId}`);
      } catch (error) {
        // check for "already has pending review" error
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.debug(`createReview failed: ${errorMessage}`);
        if (errorMessage.includes("pending review")) {
          // find the existing pending review
          log.debug(`pending review already exists, fetching existing review...`);
          const existing = await findPendingReview(ctx, pull_number);
          if (!existing) {
            throw new Error(
              "GitHub says a pending review exists but we couldn't find it. Try again or check the PR reviews."
            );
          }
          reviewId = existing.id;
          reviewNodeId = existing.node_id;
          log.debug(`reusing existing pending review: id=${reviewId}`);
        } else {
          throw error;
        }
      }

      // set PR context and review state
      ctx.toolState.prNumber = pull_number;
      ctx.toolState.review = {
        nodeId: reviewNodeId,
        id: reviewId,
      };

      log.debug(`review session started: id=${reviewId}, nodeId=${reviewNodeId}`);

      return {
        message: `Review session started for PR #${pull_number}. Add comments with add_review_comment, then submit with submit_review.`,
      };
    }),
  });
}

// add_review_comment tool
export const AddReviewComment = type({
  path: type.string.describe("The file path to comment on (relative to repo root)"),
  line: type.number.describe(
    "The line number in the file (use line numbers from the diff - the NEW file line number)"
  ),
  body: type.string.describe("The comment text for this specific line"),
  side: type
    .enumerated("LEFT", "RIGHT")
    .describe("Side of the diff: LEFT (old code) or RIGHT (new code). Defaults to RIGHT.")
    .optional(),
});

export function AddReviewCommentTool(ctx: ToolContext) {
  return tool({
    name: "add_review_comment",
    description:
      "Add a comment to the current review session. Must call start_review first. Comments are stored in draft state until submit_review is called.",
    parameters: AddReviewComment,
    execute: execute(async ({ path, line, body, side }) => {
      // check if review started
      if (!ctx.toolState.review) {
        throw new Error("No review session started. Call start_review first.");
      }

      const reviewNodeId = ctx.toolState.review.nodeId;
      log.debug(
        `adding review comment: reviewNodeId=${reviewNodeId}, path=${path}, line=${line}, side=${side || "RIGHT"}`
      );

      // add comment thread via GraphQL (REST doesn't support adding to existing pending review)
      let result: AddPullRequestReviewThreadResponse;
      try {
        result = await ctx.octokit.graphql<AddPullRequestReviewThreadResponse>(
          ADD_PULL_REQUEST_REVIEW_THREAD,
          {
            pullRequestReviewId: reviewNodeId,
            path,
            line,
            body,
            side: side || "RIGHT",
            subjectType: "LINE",
          }
        );
        log.debug(`addPullRequestReviewThread response: ${JSON.stringify(result)}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.debug(`addPullRequestReviewThread error: ${errorMsg}`);
        throw new Error(
          `Failed to add comment to ${path}:${line}. GraphQL error: ${errorMsg}. ` +
            `Ensure the line is part of the diff and the path is correct.`
        );
      }

      // check if the mutation succeeded - null means the line is not in the diff
      if (!result) {
        throw new Error(
          `Failed to add comment to ${path}:${line}. GraphQL returned null response.`
        );
      }
      if (!result.addPullRequestReviewThread) {
        throw new Error(
          `Failed to add comment to ${path}:${line}. addPullRequestReviewThread is null. Response: ${JSON.stringify(result)}`
        );
      }
      if (!result.addPullRequestReviewThread.thread) {
        throw new Error(
          `Failed to add comment to ${path}:${line}. thread is null. The line must be part of the diff. Response: ${JSON.stringify(result)}`
        );
      }

      const threadId = result.addPullRequestReviewThread.thread.id;
      log.debug(`review comment added: threadId=${threadId}`);

      return {
        success: true,
        message: `Comment added to ${path}:${line}`,
        threadId,
      };
    }),
  });
}

// submit_review tool
export const SubmitReview = type({
  body: type.string
    .describe(
      "Review body text. Typically 1-3 sentences with high-level overview and urgency level. Action links are auto-appended."
    )
    .optional(),
});

export function SubmitReviewTool(ctx: ToolContext) {
  return tool({
    name: "submit_review",
    description:
      "Submit the current review session. All comments added via add_review_comment will be published. Must call start_review first.",
    parameters: SubmitReview,
    execute: execute(async ({ body }) => {
      // check if review started
      if (!ctx.toolState.review) {
        throw new Error("No review session started. Call start_review first.");
      }
      if (ctx.toolState.prNumber === undefined) {
        throw new Error("No PR context. Call checkout_pr or start_review first.");
      }

      const reviewId = ctx.toolState.review.id;
      log.debug(
        `submitting review: id=${reviewId}, nodeId=${ctx.toolState.review.nodeId}, prNumber=${ctx.toolState.prNumber}`
      );

      // build quick links footer
      const apiUrl = process.env.API_URL || "https://pullfrog.com";
      const fixAllUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${ctx.toolState.prNumber}?action=fix&review_id=${reviewId}`;
      const fixApprovedUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${ctx.toolState.prNumber}?action=fix-approved&review_id=${reviewId}`;

      const footer = buildPullfrogFooter({
        workflowRun: { owner: ctx.owner, repo: ctx.name, runId: ctx.runId, jobId: ctx.jobId },
        customParts: [`[Fix all ➔](${fixAllUrl})`, `[Fix 👍s ➔](${fixApprovedUrl})`],
      });

      const bodyWithFooter = (body || "") + footer;

      // submit the pending review via REST
      const result = await ctx.octokit.rest.pulls.submitReview({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number: ctx.toolState.prNumber,
        review_id: reviewId,
        event: "COMMENT",
        body: bodyWithFooter,
      });

      log.debug(`submitReview response: ${JSON.stringify(result.data)}`);
      if (!result.data.id) {
        throw new Error(`submitReview returned invalid data: ${JSON.stringify(result.data)}`);
      }
      log.debug(`review submitted: reviewId=${result.data.id}, state=${result.data.state}`);

      // clear review state
      delete ctx.toolState.review;

      // delete progress comment
      await deleteProgressComment(ctx);

      return {
        success: true,
        reviewId: result.data.id,
        html_url: result.data.html_url,
        state: result.data.state,
      };
    }),
  });
}
*/
