import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const GetReviewComments = type({
  pull_number: type.number.describe("The pull request number"),
  review_id: type.number.describe("The review ID to get comments for"),
});

export const GetReviewCommentsTool = tool({
  name: "get_review_comments",
  description:
    "Get all review comments for a specific pull request review. Returns line-by-line comments that were left on specific code locations.",
  parameters: GetReviewComments,
  execute: contextualize(async ({ pull_number, review_id }, ctx) => {
    const comments = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listCommentsForReview, {
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
      review_id,
    });

    return {
      review_id,
      pull_number,
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: comment.side,
        start_line: comment.start_line,
        start_side: comment.start_side,
        user: typeof comment.user === "string" ? comment.user : comment.user?.login,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
        in_reply_to_id: comment.in_reply_to_id,
        diff_hunk: comment.diff_hunk,
        reactions: comment.reactions,
      })),
      count: comments.length,
    };
  }),
});

export const ListPullRequestReviews = type({
  pull_number: type.number.describe("The pull request number to list reviews for"),
});

export const ListPullRequestReviewsTool = tool({
  name: "list_pull_request_reviews",
  description:
    "List all reviews for a pull request. Returns all reviews including approvals, request changes, and comments.",
  parameters: ListPullRequestReviews,
  execute: contextualize(async ({ pull_number }, ctx) => {
    const reviews = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listReviews, {
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
    });

    return {
      pull_number,
      reviews: reviews.map((review) => ({
        id: review.id,
        body: review.body,
        state: review.state,
        user: review.user?.login,
        commit_id: review.commit_id,
        submitted_at: review.submitted_at,
        html_url: review.html_url,
      })),
      count: reviews.length,
    };
  }),
});
