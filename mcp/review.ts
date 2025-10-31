import type { RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const Review = type({
  pull_number: type.number.describe("The pull request number to review"),
  event: type
    .enumerated("APPROVE", "REQUEST_CHANGES", "COMMENT")
    .describe("'APPROVE', 'REQUEST_CHANGES', or 'COMMENT' (the review action)"),
  body: type.string
    .describe(
      "Brief summary or general feedback that doesn't apply to specific code locations. Keep it concise - most feedback should be in the 'comments' array."
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
    body: type.string.describe("The comment text for this specific line"),
    start_line: type.number
      .describe("Start line for multi-line comments (optional, for commenting on ranges)")
      .optional(),
  })
    .array()
    .describe(
      "REQUIRED: Array of inline comments for specific code issues. Use this for all location-specific feedback. Use 'git diff origin/<base>...origin/<head>' to find the correct line numbers (typically use the line numbers shown on the RIGHT side for new code, LEFT side for old code)."
    )
    .optional(),
});

export const ReviewTool = tool({
  name: "submit_pull_request_review",
  description:
    "Submit a review (approve, request changes, or comment) for an existing pull request. " +
    "IMPORTANT: Use 'comments' array for ALL specific code issues at the line-level. " +
    "Only use 'body' for a brief summary or feedback that doesn't apply to a specific location.",
  parameters: Review,
  execute: contextualize(async ({ pull_number, event, body, commit_id, comments = [] }, ctx) => {
    // Get the PR to determine the head commit if commit_id not provided
    const pr = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    // Compose the request
    const params: RestEndpointMethodTypes["pulls"]["createReview"]["parameters"] = {
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
      event,
    };
    if (body) params.body = body;
    if (commit_id) {
      params.commit_id = commit_id;
    } else {
      params.commit_id = pr.data.head.sha;
    }
    if (comments.length > 0) {
      type ReviewComment = (typeof params.comments & {})[number];
      // Convert comments to the format expected by GitHub API
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
    return {
      success: true,
      reviewId: result.data.id,
      html_url: result.data.html_url,
      state: result.data.state,
      user: result.data.user?.login,
      submitted_at: result.data.submitted_at,
    };
  }),
});
