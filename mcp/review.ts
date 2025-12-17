import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import type { Context } from "../main.ts";
import { buildPullfrogFooter } from "../utils/buildPullfrogFooter.ts";
import { deleteProgressComment } from "./comment.ts";
import { execute, tool } from "./shared.ts";

// graphql mutation to create a pending review
const ADD_PULL_REQUEST_REVIEW = `
mutation AddPullRequestReview($pullRequestId: ID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, event: PENDING }) {
    pullRequestReview {
      id
      databaseId
    }
  }
}
`;

// graphql mutation to add a comment thread to a pending review
const ADD_PULL_REQUEST_REVIEW_THREAD = `
mutation AddPullRequestReviewThread($pullRequestReviewId: ID!, $path: String!, $line: Int!, $body: String!, $side: DiffSide) {
  addPullRequestReviewThread(input: {
    pullRequestReviewId: $pullRequestReviewId,
    path: $path,
    line: $line,
    body: $body,
    side: $side
  }) {
    thread {
      id
    }
  }
}
`;

// graphql mutation to submit a pending review
const SUBMIT_PULL_REQUEST_REVIEW = `
mutation SubmitPullRequestReview($pullRequestReviewId: ID!, $body: String, $event: PullRequestReviewEvent!) {
  submitPullRequestReview(input: {
    pullRequestReviewId: $pullRequestReviewId,
    body: $body,
    event: $event
  }) {
    pullRequestReview {
      id
      databaseId
      state
      url
    }
  }
}
`;

// graphql response types
type AddPullRequestReviewResponse = {
  addPullRequestReview: {
    pullRequestReview: {
      id: string;
      databaseId: number;
    };
  };
};

type AddPullRequestReviewThreadResponse = {
  addPullRequestReviewThread: {
    thread: {
      id: string;
    };
  };
};

type SubmitPullRequestReviewResponse = {
  submitPullRequestReview: {
    pullRequestReview: {
      id: string;
      databaseId: number;
      state: string;
      url: string;
    };
  };
};

// review state stored in ctx
export interface ReviewState {
  reviewId: string; // graphql node ID
  reviewDatabaseId: number; // rest API ID
  pullNumber: number;
  scratchpadPath: string;
  commentCount: number;
}

// start_review tool
export const StartReview = type({
  pull_number: type.number.describe("The pull request number to review"),
});

export function StartReviewTool(ctx: Context) {
  return tool({
    name: "start_review",
    description:
      "Start a new review session for a pull request. Creates a scratchpad file for gathering thoughts and a pending review on GitHub. Must be called before add_review_comment.",
    parameters: StartReview,
    execute: execute(ctx, async ({ pull_number }) => {
      // check if review already started
      if (ctx.reviewState) {
        throw new Error(
          `Review session already started for PR #${ctx.reviewState.pullNumber}. Call submit_review first to finish it.`
        );
      }

      // get the PR to get its node_id for GraphQL
      const pr = await ctx.octokit.rest.pulls.get({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
      });

      // create pending review via GraphQL
      const response = await ctx.octokit.graphql<AddPullRequestReviewResponse>(
        ADD_PULL_REQUEST_REVIEW,
        {
          pullRequestId: pr.data.node_id,
        }
      );

      const reviewId = response.addPullRequestReview.pullRequestReview.id;
      const reviewDatabaseId = response.addPullRequestReview.pullRequestReview.databaseId;

      // create scratchpad file
      const scratchpadId = randomBytes(4).toString("hex");
      const scratchpadPath = join(ctx.sharedTempDir, `pullfrog-review-${scratchpadId}.md`);
      const scratchpadContent = `# Review ${scratchpadId}\n\n`;
      writeFileSync(scratchpadPath, scratchpadContent);

      // store review state in ctx
      ctx.reviewState = {
        reviewId,
        reviewDatabaseId,
        pullNumber: pull_number,
        scratchpadPath,
        commentCount: 0,
      };

      return {
        reviewId: scratchpadId,
        scratchpadPath,
        message: `Review session started. Use the scratchpad file to gather your thoughts, then call add_review_comment for each comment.`,
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

export function AddReviewCommentTool(ctx: Context) {
  return tool({
    name: "add_review_comment",
    description:
      "Add a comment to the current review session. Must call start_review first. Comments are stored in draft state until submit_review is called.",
    parameters: AddReviewComment,
    execute: execute(ctx, async ({ path, line, body, side }) => {
      // check if review started
      if (!ctx.reviewState) {
        throw new Error("No review session started. Call start_review first.");
      }

      // add comment thread via GraphQL
      await ctx.octokit.graphql<AddPullRequestReviewThreadResponse>(
        ADD_PULL_REQUEST_REVIEW_THREAD,
        {
          pullRequestReviewId: ctx.reviewState.reviewId,
          path,
          line,
          body,
          side: side || "RIGHT",
        }
      );

      ctx.reviewState.commentCount++;

      return {
        success: true,
        commentCount: ctx.reviewState.commentCount,
        message: `Comment added to ${path}:${line}`,
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

export function SubmitReviewTool(ctx: Context) {
  return tool({
    name: "submit_review",
    description:
      "Submit the current review session. All comments added via add_review_comment will be published. Must call start_review first.",
    parameters: SubmitReview,
    execute: execute(ctx, async ({ body }) => {
      // check if review started
      if (!ctx.reviewState) {
        throw new Error("No review session started. Call start_review first.");
      }

      const pullNumber = ctx.reviewState.pullNumber;
      const reviewDatabaseId = ctx.reviewState.reviewDatabaseId;

      // build quick links footer
      const apiUrl = process.env.API_URL || "https://pullfrog.com";
      const fixAllUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${pullNumber}?action=fix&review_id=${reviewDatabaseId}`;
      const fixApprovedUrl = `${apiUrl}/trigger/${ctx.owner}/${ctx.name}/${pullNumber}?action=fix-approved&review_id=${reviewDatabaseId}`;

      const footer = buildPullfrogFooter({
        workflowRun: { owner: ctx.owner, repo: ctx.name, runId: ctx.runId, jobId: ctx.jobId },
        customParts: [`[Fix all ➔](${fixAllUrl})`, `[Fix 👍s ➔](${fixApprovedUrl})`],
      });

      const bodyWithFooter = (body || "") + footer;

      // submit the review via GraphQL
      const response = await ctx.octokit.graphql<SubmitPullRequestReviewResponse>(
        SUBMIT_PULL_REQUEST_REVIEW,
        {
          pullRequestReviewId: ctx.reviewState.reviewId,
          body: bodyWithFooter,
          event: "COMMENT",
        }
      );

      const result = response.submitPullRequestReview.pullRequestReview;
      const commentCount = ctx.reviewState.commentCount;

      // clear review state
      ctx.reviewState = undefined;

      // delete progress comment
      await deleteProgressComment(ctx);

      return {
        success: true,
        reviewId: result.databaseId,
        html_url: result.url,
        state: result.state,
        commentCount,
      };
    }),
  });
}

// legacy tool - kept for backwards compatibility
export const Review = type({
  pull_number: type.number.describe("The pull request number to review"),
  body: type.string
    .describe(
      "1-2 sentence high-level summary ONLY. Include urgency level and critical callouts (e.g., API key leak). ALL specific feedback MUST go in 'comments' array instead."
    )
    .optional(),
  commit_id: type.string
    .describe("Optional SHA of the commit being reviewed. Defaults to latest.")
    .optional(),
  comments: type({
    path: type.string.describe("The file path to comment on (relative to repo root)"),
    line: type.number.describe(
      "The line number in the file (use line numbers from the diff - usually the RIGHT side/new code)"
    ),
    side: type
      .enumerated("LEFT", "RIGHT")
      .describe(
        "Side of the diff: LEFT (old code) or RIGHT (new code). Defaults to RIGHT if not provided."
      )
      .optional(),
    body: type.string.describe(
      "The comment text for this specific line. For issues appearing multiple times, comment on the first occurrence and reference others."
    ),
    start_line: type.number
      .describe("Start line for multi-line comments (optional, for commenting on ranges)")
      .optional(),
  })
    .array()
    .describe(
      // FORK PR NOTE: use HEAD not origin/<head> - for fork PRs, origin/<head> doesn't exist
      // because the head branch is in a different repo (the fork). HEAD is the locally checked out PR branch.
      "PRIMARY location for ALL feedback. 95%+ of review content should be here. Use 'git diff origin/<base>..HEAD' to find correct line numbers (RIGHT side for new code, LEFT for old). Works for both fork and same-repo PRs."
    )
    .optional(),
});

export function ReviewTool(ctx: Context) {
  return tool({
    name: "submit_pull_request_review",
    description:
      "DEPRECATED: Use start_review, add_review_comment, and submit_review instead for iterative review workflow. " +
      "Submit a review for an existing pull request. " +
      "IMPORTANT: 95%+ of feedback should be in 'comments' array with file paths and line numbers. " +
      "Only use 'body' for a 1-2 sentence summary with urgency and critical callouts.",
    parameters: Review,
    execute: execute(ctx, async ({ pull_number, body, commit_id, comments = [] }) => {
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
