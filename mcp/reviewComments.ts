import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { execute, tool } from "./shared.ts";

// graphql query to fetch all review threads with comments and replies
// note: diffSide and startDiffSide are on the thread, not the comment
const REVIEW_THREADS_QUERY = `
query ($owner: String!, $repo: String!, $pullNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pullNumber) {
      reviewThreads(first: 100) {
        nodes {
          diffSide
          startDiffSide
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              path
              line
              startLine
              url
              author {
                login
              }
              createdAt
              updatedAt
              pullRequestReview {
                databaseId
              }
              replyTo {
                databaseId
              }
            }
          }
        }
      }
    }
  }
}
`;

// graphql response types (nodes arrays can contain nulls per GitHub GraphQL spec)
type GraphQLReviewComment = {
  id: string;
  databaseId: number;
  body: string;
  path: string;
  line: number | null;
  startLine: number | null;
  url: string;
  author: {
    login: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  pullRequestReview: {
    databaseId: number;
  } | null;
  replyTo: {
    databaseId: number;
  } | null;
};

type GraphQLReviewThread = {
  diffSide: "LEFT" | "RIGHT";
  startDiffSide: "LEFT" | "RIGHT" | null;
  comments: {
    nodes: (GraphQLReviewComment | null)[] | null;
  } | null;
} | null;

type GraphQLResponse = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: (GraphQLReviewThread | null)[] | null;
      } | null;
    } | null;
  } | null;
};

export const GetReviewComments = type({
  pull_number: type.number.describe("The pull request number"),
  review_id: type.number.describe("The review ID to get comments for"),
});

export function GetReviewCommentsTool(ctx: ToolContext) {
  return tool({
    name: "get_review_comments",
    description:
      "Get all review comments and their replies for a specific pull request review. Returns line-by-line comments that were left on specific code locations, including any threaded replies.",
    parameters: GetReviewComments,
    execute: execute(async ({ pull_number, review_id }) => {
        // fetch all review threads using graphql
        const response = await ctx.octokit.graphql<GraphQLResponse>(REVIEW_THREADS_QUERY, {
          owner: ctx.owner,
          repo: ctx.name,
          pullNumber: pull_number,
        });

        const pullRequest = response.repository?.pullRequest;
        if (!pullRequest) {
          return {
            review_id,
            pull_number,
            comments: [],
            count: 0,
          };
        }

        const threadNodes = pullRequest.reviewThreads?.nodes;
        if (!threadNodes) {
          return {
            review_id,
            pull_number,
            comments: [],
            count: 0,
          };
        }

        const allComments: {
          id: number;
          body: string;
          path: string;
          line: number | null;
          side: "LEFT" | "RIGHT";
          start_line: number | null;
          start_side: "LEFT" | "RIGHT" | null;
          user: string | null;
          created_at: string;
          updated_at: string;
          html_url: string;
          in_reply_to_id: number | null;
          pull_request_review_id: number | null;
        }[] = [];

        // iterate through all threads (filter out nulls)
        for (const thread of threadNodes) {
          if (!thread?.comments?.nodes) continue;

          // filter out null comments
          const threadComments = thread.comments.nodes.filter(
            (c): c is GraphQLReviewComment => c !== null
          );
          if (threadComments.length === 0) continue;

          // find the root comment (the one with replyTo == null) to determine thread ownership
          const rootComment = threadComments.find((c) => c.replyTo === null);
          if (!rootComment) continue;

          // check if this thread belongs to the target review using the root comment
          const threadBelongsToReview = rootComment.pullRequestReview?.databaseId === review_id;
          if (!threadBelongsToReview) continue;

          // include all comments from this thread (original + replies)
          // side info comes from thread level, not comment level
          for (const comment of threadComments) {
            allComments.push({
              id: comment.databaseId,
              body: comment.body,
              path: comment.path,
              line: comment.line,
              start_line: comment.startLine,
              side: thread.diffSide,
              start_side: thread.startDiffSide,
              user: comment.author?.login ?? null,
              created_at: comment.createdAt,
              updated_at: comment.updatedAt,
              html_url: comment.url,
              in_reply_to_id: comment.replyTo?.databaseId ?? null,
              pull_request_review_id: comment.pullRequestReview?.databaseId ?? null,
            });
          }
        }

        return {
          review_id,
          pull_number,
          comments: allComments,
          count: allComments.length,
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
}
