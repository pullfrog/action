import { type } from "arktype";
import type { Context } from "../main.ts";
import { log } from "../utils/cli.ts";
import { containsSecrets } from "../utils/secrets.ts";
import { $ } from "../utils/shell.ts";
import { execute, tool } from "./shared.ts";

export const PullRequest = type({
  title: type.string.describe("the title of the pull request"),
  body: type.string.describe("the body content of the pull request"),
  base: type.string.describe("the base branch to merge into (e.g., 'main')"),
});

export function PullRequestTool(ctx: Context) {
  return tool({
    name: "create_pull_request",
    description: "Create a pull request from the current branch",
    parameters: PullRequest,
    execute: execute(ctx, async ({ title, body, base }) => {
      const currentBranch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false });
      log.info(`Current branch: ${currentBranch}`);

      // validate PR title and body for secrets
      if (containsSecrets(title) || containsSecrets(body)) {
        throw new Error(
          "PR creation blocked: secrets detected in PR title or body. " +
            "Please remove any sensitive information (API keys, tokens, passwords) before creating a PR."
        );
      }

      // validate all changes that would be in the PR (from base to HEAD)
      const diff = $("git", ["diff", `origin/${base}...HEAD`], { log: false });
      if (containsSecrets(diff)) {
        throw new Error(
          "PR creation blocked: secrets detected in changes. " +
            "Please remove any sensitive information (API keys, tokens, passwords) before creating a PR."
        );
      }

      const result = await ctx.octokit.rest.pulls.create({
        owner: ctx.owner,
        repo: ctx.name,
        title: title,
        body: body,
        head: currentBranch,
        base: base,
      });

      return {
        success: true,
        pullRequestId: result.data.id,
        number: result.data.number,
        url: result.data.html_url,
        title: result.data.title,
        head: result.data.head.ref,
        base: result.data.base.ref,
      };
    }),
  });
}
