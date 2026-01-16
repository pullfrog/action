import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type } from "arktype";
import { log } from "../utils/log.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const GetReviewComments = type({
  pull_number: type.number.describe("The pull request number"),
  review_id: type.number.describe("The review ID to get comments for"),
  approved_by: type.string
    .describe("Optional GitHub username - only return comments this user gave a 👍 to")
    .optional(),
});

export function GetReviewCommentsTool(ctx: ToolContext) {
  return tool({
    name: "get_review_comments",
    description:
      "Get review comments for a pull request review, including diff context. " +
      "When approved_by is provided, only returns comments that user approved with 👍. " +
      "Returns commentsPath pointing to a file with full comment details.",
    parameters: GetReviewComments,
    execute: execute(async ({ pull_number, review_id, approved_by }) => {
      // fetch all review comments via REST API (includes diff_hunk)
      const allComments = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listReviewComments, {
        owner: ctx.repo.owner,
        repo: ctx.repo.name,
        pull_number,
      });

      // filter to target review
      let reviewComments = allComments.filter((c) => c.pull_request_review_id === review_id);

      // filter by thumbs up if approved_by is specified
      if (approved_by) {
        const approvedIds = new Set<number>();
        for (const comment of reviewComments) {
          const reactions = await ctx.octokit.rest.reactions.listForPullRequestReviewComment({
            owner: ctx.repo.owner,
            repo: ctx.repo.name,
            comment_id: comment.id,
          });
          const hasThumbsUp = reactions.data.some(
            (r) => r.content === "+1" && r.user?.login === approved_by
          );
          if (hasThumbsUp) approvedIds.add(comment.id);
        }
        reviewComments = reviewComments.filter((c) => approvedIds.has(c.id));
      }

      if (reviewComments.length === 0) {
        return {
          review_id,
          pull_number,
          count: 0,
          commentsPath: null,
          message: approved_by
            ? `No comments with 👍 from ${approved_by}`
            : "No comments found for this review",
        };
      }

      // format comments with diff context
      const lines: string[] = [];
      for (const comment of reviewComments) {
        lines.push(`${"=".repeat(60)}`);
        lines.push(`COMMENT #${comment.id} by @${comment.user?.login ?? "unknown"}`);
        lines.push(`File: ${comment.path}:${comment.line ?? comment.original_line ?? "?"}`);
        if (comment.in_reply_to_id) {
          lines.push(`Reply to: #${comment.in_reply_to_id}`);
        }
        lines.push("");
        if (comment.diff_hunk) {
          lines.push("```diff");
          lines.push(comment.diff_hunk);
          lines.push("```");
          lines.push("");
        }
        lines.push("Comment:");
        lines.push(comment.body);
        lines.push("");
      }

      const content = lines.join("\n");

      // write to temp file
      const tempDir = process.env.PULLFROG_TEMP_DIR;
      if (!tempDir) {
        throw new Error("PULLFROG_TEMP_DIR not set");
      }
      const filename = approved_by
        ? `review-${review_id}-approved-by-${approved_by}.txt`
        : `review-${review_id}-comments.txt`;
      const commentsPath = join(tempDir, filename);
      writeFileSync(commentsPath, content);
      log.debug(`wrote ${reviewComments.length} comments to ${commentsPath}`);

      return {
        review_id,
        pull_number,
        count: reviewComments.length,
        commentsPath,
      };
    }),
  });
}

export const ListPullRequestReviews = type({
  pull_number: type.number.describe("The pull request number to list reviews for"),
});

export function ListPullRequestReviewsTool(ctx: ToolContext) {
  return tool({
    name: "list_pull_request_reviews",
    description:
      "List all reviews for a pull request. Returns all reviews including approvals, request changes, and comments.",
    parameters: ListPullRequestReviews,
    execute: execute(async ({ pull_number }) => {
      const reviews = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listReviews, {
        owner: ctx.repo.owner,
        repo: ctx.repo.name,
        pull_number,
      });

      return {
        pull_number,
        reviews: reviews.map((review) => ({
          id: review.id,
          body: review.body,
          state: review.state,
          user: review.user?.login,
          submitted_at: review.submitted_at,
        })),
        count: reviews.length,
      };
    }),
  });
}
