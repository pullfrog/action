import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { log } from "../utils/cli.ts";
import { containsSecrets } from "../utils/secrets.ts";
import { $ } from "../utils/shell.ts";
import { execute, tool } from "./shared.ts";

export function CreateBranchTool(ctx: ToolContext) {
  const defaultBranch = ctx.repo.default_branch || "main";

  const CreateBranch = type({
    branchName: type.string.describe(
      "The name of the branch to create (e.g., 'pullfrog/123-fix-bug')"
    ),
    baseBranch: type.string
      .describe(`The base branch to create from (defaults to '${defaultBranch}')`)
      .default(defaultBranch),
  });

  return tool({
    name: "create_branch",
    description:
      "Create a new git branch from the specified base branch. The branch will be created locally and pushed to the remote repository.",
    parameters: CreateBranch,
    execute: execute(async ({ branchName, baseBranch }) => {
      // baseBranch should always be defined due to default, but TypeScript needs help
      const resolvedBaseBranch = baseBranch || ctx.repo.default_branch || "main";

      // validate branch name for secrets
      if (containsSecrets(branchName)) {
        throw new Error(
          "Branch creation blocked: secrets detected in branch name. " +
            "Please remove any sensitive information (API keys, tokens, passwords) before creating a branch."
        );
      }

      log.debug(`Creating branch ${branchName} from ${resolvedBaseBranch}`);

      // fetch base branch to ensure we're up to date
      $("git", ["fetch", "origin", resolvedBaseBranch, "--depth=1"]);

      // checkout base branch, ensuring it matches the remote version
      // -B creates or resets the branch to match origin/baseBranch
      $("git", ["checkout", "-B", resolvedBaseBranch, `origin/${resolvedBaseBranch}`]);

      // create and checkout new branch
      $("git", ["checkout", "-b", branchName]);

      // push branch to remote (set upstream)
      $("git", ["push", "-u", "origin", branchName]);

      log.debug(`Successfully created and pushed branch ${branchName}`);

      return {
        success: true,
        branchName,
        baseBranch: resolvedBaseBranch,
        message: `Branch ${branchName} created from ${resolvedBaseBranch} and pushed to remote`,
      };
    }),
  });
}

export const CommitFiles = type({
  message: type.string.describe("The commit message"),
  files: type.string
    .array()
    .describe(
      "Array of file paths to commit (relative to repo root). If empty, commits all staged changes."
    ),
});

export function CommitFilesTool(_ctx: ToolContext) {
  return tool({
    name: "commit_files",
    description:
      "Stage and commit files with a commit message. If files array is empty, commits all staged changes. The commit will be attributed to the correct bot account.",
    parameters: CommitFiles,
    execute: execute(async ({ message, files }) => {
      // validate commit message for secrets
      if (containsSecrets(message)) {
        throw new Error(
          "Commit blocked: secrets detected in commit message. " +
            "Please remove any sensitive information (API keys, tokens, passwords) before committing."
        );
      }

      // validate files for secrets if provided
      if (files.length > 0) {
        for (const file of files) {
          try {
            // try to read file content - if it exists, check for secrets
            const content = $("cat", [file], { log: false });
            if (containsSecrets(content)) {
              throw new Error(
                `Commit blocked: secrets detected in file ${file}. ` +
                  "Please remove any sensitive information (API keys, tokens, passwords) before committing."
              );
            }
          } catch (error) {
            // if error is about secrets, re-throw it
            if (error instanceof Error && error.message.includes("Commit blocked")) {
              throw error;
            }
            // if file doesn't exist (cat fails), that's ok - it will be created by git add
            // other errors are also ok - git add will handle them
          }
        }
      }

      const currentBranch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false });
      log.debug(`Committing files on branch ${currentBranch}`);

      // stage files if provided, otherwise stage all changes
      if (files.length > 0) {
        $("git", ["add", ...files]);
      } else {
        $("git", ["add", "."]);
      }

      // commit with message
      $("git", ["commit", "-m", message]);

      const commitSha = $("git", ["rev-parse", "HEAD"], { log: false });
      log.debug(`Successfully committed: ${commitSha.substring(0, 7)}`);

      return {
        success: true,
        commitSha,
        branch: currentBranch,
        message: `Committed ${files.length > 0 ? files.length + " file(s)" : "all changes"} with message: ${message}`,
      };
    }),
  });
}

export const PushBranch = type({
  branchName: type.string
    .describe("The branch name to push (defaults to current branch)")
    .optional(),
  force: type.boolean.describe("Force push (use with caution)").default(false),
});

export function PushBranchTool(_ctx: ToolContext) {
  return tool({
    name: "push_branch",
    description:
      "Push the current branch (or specified branch) to the remote repository. Git automatically determines the correct remote based on branch config (set by checkout_pr for fork PRs). Never force push unless explicitly requested.",
    parameters: PushBranch,
    execute: execute(async ({ branchName, force }) => {
      const branch = branchName || $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false });

      // check if branch has a configured pushRemote
      let remote = "origin";
      try {
        remote = $("git", ["config", `branch.${branch}.pushRemote`], { log: false }).trim();
      } catch {
        // no configured pushRemote, default to origin
      }

      const args = force
        ? ["push", "--force", "-u", remote, branch]
        : ["push", "-u", remote, branch];

      log.debug(`pushing branch ${branch} to ${remote}`);
      if (force) {
        log.warning(`force pushing - this will overwrite remote history`);
      }
      $("git", args);

      return {
        success: true,
        branch,
        remote,
        force,
        message: `successfully pushed branch ${branch}`,
      };
    }),
  });
}
