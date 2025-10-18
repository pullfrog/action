import { type } from "arktype";
import { getMcpContext, tool } from "./shared.ts";

export const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

export const CommentTool = tool({
  name: "create_issue_comment",
  description: "Create a comment on a GitHub issue",
  parameters: Comment,
  execute: async ({ issueNumber, body }) => {
    const ctx = getMcpContext();
    try {
      const result = await ctx.octokit.rest.issues.createComment({
        owner: ctx.owner,
        repo: ctx.name,
        issue_number: issueNumber,
        body: body,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                commentId: result.data.id,
                url: result.data.html_url,
                body: result.data.body,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating comment: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
});
