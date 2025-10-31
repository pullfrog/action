import type { RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const Review = type({
  pull_number: type.number.describe("The pull request number to review"),
  event: type
    .enumerated("APPROVE", "REQUEST_CHANGES", "COMMENT")
    .describe("'APPROVE', 'REQUEST_CHANGES', or 'COMMENT' (the review action)"),
  body: type.string
    .describe("The body content for the review (required for REQUEST_CHANGES or COMMENT)")
    .optional(),
  commit_id: type.string
    .describe("Optional SHA of the commit being reviewed. Defaults to latest.")
    .optional(),
  comments: type({
    path: type.string.describe("The file path to comment on"),
    position: type.number.describe("The diff position in the file"),
    body: type.string.describe("The comment text"),
  })
    .array()
    .describe("Array of draft review comments for specific lines, optional.")
    .optional(),
});

export const ReviewTool = tool({
  name: "submit_pull_request_review",
  description:
    "Submit a review (approve, request changes, or comment) for an existing pull request.",
  parameters: Review,
  execute: contextualize(async ({ pull_number, event, body, commit_id, comments = [] }, ctx) => {
    // Compose the request
    const params: RestEndpointMethodTypes["pulls"]["createReview"]["parameters"] = {
      owner: ctx.owner,
      repo: ctx.name,
      pull_number,
      event,
    };
    if (body) params.body = body;
    if (commit_id) params.commit_id = commit_id;
    if (comments.length > 0) params.comments = comments;
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
