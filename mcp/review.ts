import type { RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import type { Context } from "../main.ts";
import { buildPullfrogFooter } from "../utils/buildPullfrogFooter.ts";
import { deleteProgressComment } from "./comment.ts";
import { execute, tool } from "./shared.ts";

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
      "PRIMARY location for ALL feedback. 95%+ of review content should be here. Use 'git diff origin/<base>...origin/<head>' to find correct line numbers (RIGHT side for new code, LEFT for old)."
    )
    .optional(),
});

export function ReviewTool(ctx: Context) {
  return tool({
    name: "submit_pull_request_review",
    description:
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
