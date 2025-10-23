import { execSync } from "node:child_process";
import { type } from "arktype";
import { getMcpContext, tool } from "./shared.ts";

export const PullRequest = type({
  title: type.string.describe("the title of the pull request"),
  body: type.string.describe("the body content of the pull request"),
  base: type.string.describe("the base branch to merge into (e.g., 'main')"),
});

export const PullRequestTool = tool({
  name: "create_pull_request",
  description: "Create a pull request from the current branch",
  parameters: PullRequest,
  execute: async ({ title, body, base }) => {
    const ctx = getMcpContext();
    try {
      // Get the current branch name
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
      }).trim();

      console.log(`Current branch: ${currentBranch}`);

      const result = await ctx.octokit.rest.pulls.create({
        owner: ctx.owner,
        repo: ctx.name,
        title: title,
        body: body,
        head: currentBranch,
        base: base,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                pullRequestId: result.data.id,
                number: result.data.number,
                url: result.data.html_url,
                title: result.data.title,
                head: result.data.head.ref,
                base: result.data.base.ref,
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
            text: `Error creating pull request: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
});
