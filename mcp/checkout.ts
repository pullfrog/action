import { type } from "arktype";
import type { Context } from "../main.ts";
import { log } from "../utils/cli.ts";
import { $ } from "../utils/shell.ts";
import { execute, tool } from "./shared.ts";

export const CheckoutPr = type({
  pull_number: type.number.describe("the pull request number to checkout"),
});

export type CheckoutPrResult = {
  success: true;
  number: number;
  title: string;
  base: string;
  head: string;
  isFork: boolean;
  maintainerCanModify: boolean;
  url: string;
  headRepo: string;
};

/**
 * Shared helper to checkout a PR branch and configure fork remotes.
 * Assumes origin remote is already configured with authentication.
 */
export async function checkoutPrBranch(ctx: Context, pull_number: number): Promise<void> {
  log.info(`🔀 checking out PR #${pull_number}...`);

  // fetch PR metadata
  const pr = await ctx.octokit.rest.pulls.get({
    owner: ctx.owner,
    repo: ctx.name,
    pull_number,
  });

  const headRepo = pr.data.head.repo;
  if (!headRepo) {
    throw new Error(`PR #${pull_number} source repository was deleted`);
  }

  const isFork = headRepo.full_name !== pr.data.base.repo.full_name;
  const baseBranch = pr.data.base.ref;
  const headBranch = pr.data.head.ref;

  // check if we're already on the correct branch
  const currentBranch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false }).trim();
  const alreadyOnBranch = currentBranch === headBranch;

  if (alreadyOnBranch) {
    log.info(`already on PR branch ${headBranch}, skipping checkout`);
  } else {
    // fetch base branch so origin/<base> exists for diff operations
    log.info(`📥 fetching base branch (${baseBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", baseBranch]);

    // checkout base branch first to avoid "refusing to fetch into current branch" error
    // -B creates or resets the branch to match origin/baseBranch
    $("git", ["checkout", "-B", baseBranch, `origin/${baseBranch}`]);

    // fetch PR branch using pull/{n}/head refspec (works for both fork and same-repo PRs)
    log.info(`🌿 fetching PR #${pull_number} (${headBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", `pull/${pull_number}/head:${headBranch}`]);

    // checkout the branch
    $("git", ["checkout", headBranch]);
    log.info(`✓ checked out PR #${pull_number}`);
  }

  // ensure base branch is fetched (needed for diff operations)
  // fetch if we skipped checkout (already on branch) - otherwise already fetched above
  if (alreadyOnBranch) {
    log.info(`📥 fetching base branch (${baseBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", baseBranch]);
  }

  // configure push remote for this branch
  // NOTE: This always runs regardless of alreadyOnBranch, because setupGit doesn't configure
  // fork remotes. This ensures fork PRs can push even when checkout_pr is called after setupGit.
  if (isFork) {
    const remoteName = `pr-${pull_number}`;
    const forkUrl = `https://x-access-token:${ctx.githubInstallationToken}@github.com/${headRepo.full_name}.git`;

    // add fork as a named remote (ignore error if already exists)
    try {
      $("git", ["remote", "add", remoteName, forkUrl]);
      log.info(`📌 added remote '${remoteName}' for fork ${headRepo.full_name}`);
    } catch {
      // remote already exists, update its URL
      $("git", ["remote", "set-url", remoteName, forkUrl]);
      log.info(`📌 updated remote '${remoteName}' for fork ${headRepo.full_name}`);
    }

    // set branch push config so `git push` knows where to push
    $("git", ["config", `branch.${headBranch}.pushRemote`, remoteName]);
    log.info(`📌 configured branch '${headBranch}' to push to '${remoteName}'`);

    // warn if maintainer can't modify (push will likely fail)
    if (!pr.data.maintainer_can_modify) {
      log.warning(
        `⚠️ fork PR has maintainer_can_modify=false - push operations will fail. ` +
          `ask the PR author to enable "Allow edits from maintainers" or the fork may be owned by an organization.`
      );
    }
  } else {
    // for same-repo PRs, push to origin
    $("git", ["config", `branch.${headBranch}.pushRemote`, "origin"]);
  }

  // set PR context
  ctx.toolState.prNumber = pull_number;
}

export function CheckoutPrTool(ctx: Context) {
  return tool({
    name: "checkout_pr",
    description:
      "Checkout a pull request branch locally. This fetches the PR branch and sets up push configuration for fork PRs. Use this when you need to work on an existing PR.",
    parameters: CheckoutPr,
    execute: execute(ctx, async ({ pull_number }) => {
      await checkoutPrBranch(ctx, pull_number);

      // fetch PR metadata to return result
      const pr = await ctx.octokit.rest.pulls.get({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
      });

      const headRepo = pr.data.head.repo;
      if (!headRepo) {
        throw new Error(`PR #${pull_number} source repository was deleted`);
      }

      return {
        success: true,
        number: pr.data.number,
        title: pr.data.title,
        base: pr.data.base.ref,
        head: pr.data.head.ref,
        isFork: headRepo.full_name !== pr.data.base.repo.full_name,
        maintainerCanModify: pr.data.maintainer_can_modify,
        url: pr.data.html_url,
        headRepo: headRepo.full_name,
      } satisfies CheckoutPrResult;
    }),
  });
}
