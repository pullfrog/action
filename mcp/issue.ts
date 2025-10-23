import { type } from "arktype";
import { getMcpContext, tool } from "./shared.ts";

export const Issue = type({
  title: type.string.describe("the title of the issue"),
  body: type.string.describe("the body content of the issue"),
  labels: type.string
    .array()
    .describe("optional array of label names to apply to the issue")
    .optional(),
  assignees: type.string
    .array()
    .describe("optional array of usernames to assign to the issue")
    .optional(),
});

export const IssueTool = tool({
  name: "create_issue",
  description: "Create a new GitHub issue",
  parameters: Issue,
  execute: async ({ title, body, labels, assignees }) => {
    const ctx = getMcpContext();
    try {
      const result = await ctx.octokit.rest.issues.create({
        owner: ctx.owner,
        repo: ctx.name,
        title: title,
        body: body,
        labels: labels ?? [],
        assignees: assignees ?? [],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                issueId: result.data.id,
                number: result.data.number,
                url: result.data.html_url,
                title: result.data.title,
                state: result.data.state,
                labels: result.data.labels?.map((label) =>
                  typeof label === "string" ? label : label.name
                ),
                assignees: result.data.assignees?.map((assignee) => assignee.login),
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
            text: `Error creating issue: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
});
