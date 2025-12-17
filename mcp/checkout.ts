import type { Octokit } from "@octokit/rest";
import { type } from "arktype";
import type { ToolContext } from "../main.ts";
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

interface CheckoutPrBranchParams {
  octokit: Octokit;
  owner: string;
  name: string;
  token: string;
  pullNumber: number;
}

interface CheckoutPrBranchResult {
  prNumber: number;
}

/**
 * Shared helper to checkout a PR branch and configure fork remotes.
 * Assumes origin remote is already configured with authentication.
 * Returns the PR number for caller to set on toolState.
 */
export async function checkoutPrBranch(
  params: CheckoutPrBranchParams
): Promise<CheckoutPrBranchResult> {
  const { octokit, owner, name, token, pullNumber } = params;
  log.info(`🔀 checking out PR #${pullNumber}...`);

  // fetch PR metadata
  const pr = await octokit.rest.pulls.get({
    owner,
    repo: name,
    pull_number: pullNumber,
  });

  const headRepo = pr.data.head.repo;
  if (!headRepo) {
    throw new Error(`PR #${pullNumber} source repository was deleted`);
  }

  const isFork = headRepo.full_name !== pr.data.base.repo.full_name;
  const baseBranch = pr.data.base.ref;
  const headBranch = pr.data.head.ref;

  // check if we're already on the correct branch
  const currentBranch = $("git", ["rev-parse", "--abbrev-ref", "HEAD"], { log: false }).trim();
  const alreadyOnBranch = currentBranch === headBranch;

  if (alreadyOnBranch) {
    log.debug(`already on PR branch ${headBranch}, skipping checkout`);
  } else {
    // fetch base branch so origin/<base> exists for diff operations
    log.debug(`📥 fetching base branch (${baseBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", baseBranch]);

    // checkout base branch first to avoid "refusing to fetch into current branch" error
    // -B creates or resets the branch to match origin/baseBranch
    $("git", ["checkout", "-B", baseBranch, `origin/${baseBranch}`]);

    // fetch PR branch using pull/{n}/head refspec (works for both fork and same-repo PRs)
    log.debug(`🌿 fetching PR #${pullNumber} (${headBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", `pull/${pullNumber}/head:${headBranch}`]);

    // checkout the branch
    $("git", ["checkout", headBranch]);
    log.debug(`✓ checked out PR #${pullNumber}`);
  }

  // ensure base branch is fetched (needed for diff operations)
  // fetch if we skipped checkout (already on branch) - otherwise already fetched above
  if (alreadyOnBranch) {
    log.debug(`📥 fetching base branch (${baseBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", baseBranch]);
  }

  // configure push remote for this branch
  // NOTE: This always runs regardless of alreadyOnBranch, because setupGit doesn't configure
  // fork remotes. This ensures fork PRs can push even when checkout_pr is called after setupGit.
  if (isFork) {
    const remoteName = `pr-${pullNumber}`;
    const forkUrl = `https://x-access-token:${token}@github.com/${headRepo.full_name}.git`;

    // add fork as a named remote (ignore error if already exists)
    try {
      $("git", ["remote", "add", remoteName, forkUrl]);
      log.debug(`📌 added remote '${remoteName}' for fork ${headRepo.full_name}`);
    } catch {
      // remote already exists, update its URL
      $("git", ["remote", "set-url", remoteName, forkUrl]);
      log.debug(`📌 updated remote '${remoteName}' for fork ${headRepo.full_name}`);
    }

    // set branch push config so `git push` knows where to push
    $("git", ["config", `branch.${headBranch}.pushRemote`, remoteName]);
    log.debug(`📌 configured branch '${headBranch}' to push to '${remoteName}'`);

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

  return { prNumber: pullNumber };
}

export function CheckoutPrTool(ctx: ToolContext) {
  return tool({
    name: "checkout_pr",
    description:
      "Checkout a pull request branch locally. This fetches the PR branch and sets up push configuration for fork PRs. Use this when you need to work on an existing PR.",
    parameters: CheckoutPr,
    execute: execute(async ({ pull_number }) => {
      const result = await checkoutPrBranch({
        octokit: ctx.octokit,
        owner: ctx.owner,
        name: ctx.name,
        token: ctx.githubInstallationToken,
        pullNumber: pull_number,
      });

      // set prNumber on toolState
      ctx.toolState.prNumber = result.prNumber;

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
