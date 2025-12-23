import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { log } from "../utils/cli.ts";
import { $ } from "../utils/shell.ts";
import { execute, tool } from "./shared.ts";

type PullFile = RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"][number];

/**
 * formats PR files with explicit line numbers for each code line.
 * preserves all original diff info (file headers, hunk headers) and adds:
 * | OLD | NEW | TYPE | code
 */
export function formatFilesWithLineNumbers(files: PullFile[]): string {
  const output: string[] = [];

  for (const file of files) {
    // file header
    output.push(`diff --git a/${file.filename} b/${file.filename}`);
    output.push(`--- a/${file.filename}`);
    output.push(`+++ b/${file.filename}`);

    if (!file.patch) {
      output.push("(binary file or no changes)");
      output.push("");
      continue;
    }

    // parse and format the patch with line numbers
    const lines = file.patch.split("\n");
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      // hunk header: @@ -OLD,COUNT +NEW,COUNT @@ optional context
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        output.push(line); // pass through unchanged
        continue;
      }

      // code lines within hunks
      const changeType = line[0] || " ";
      const code = line.slice(1);

      if (changeType === "-") {
        // removed line: show old line number, no new line number
        output.push(`| ${padNum(oldLine)} |      | - | ${code}`);
        oldLine++;
      } else if (changeType === "+") {
        // added line: no old line number, show new line number
        output.push(`|      | ${padNum(newLine)} | + | ${code}`);
        newLine++;
      } else if (changeType === " " || changeType === "\\") {
        // context line or "\ No newline at end of file"
        if (changeType === "\\") {
          output.push(line); // pass through as-is
        } else {
          output.push(`| ${padNum(oldLine)} | ${padNum(newLine)} |   | ${code}`);
          oldLine++;
          newLine++;
        }
      } else {
        // unknown line type, pass through
        output.push(line);
      }
    }
    output.push(""); // blank line between files
  }

  return output.join("\n");
}

function padNum(n: number): string {
  return n.toString().padStart(4, " ");
}

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
  diffPath: string;
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

  // always use pr-{number} as local branch name for consistency
  // this avoids naming conflicts and makes push config simpler
  const localBranch = `pr-${pullNumber}`;

  // check if we're already on the correct commit (not just branch name)
  // this handles fork PRs where head branch name might match base branch name
  const currentSha = $("git", ["rev-parse", "HEAD"], { log: false }).trim();
  const alreadyOnBranch = currentSha === pr.data.head.sha;

  if (alreadyOnBranch) {
    log.debug(`already on PR branch ${localBranch}, skipping checkout`);
  } else {
    // fetch base branch so origin/<base> exists for diff operations
    log.debug(`📥 fetching base branch (${baseBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", baseBranch]);

    // checkout base branch first to avoid "refusing to fetch into current branch" error
    // -B creates or resets the branch to match origin/baseBranch
    $("git", ["checkout", "-B", baseBranch, `origin/${baseBranch}`]);

    // fetch PR branch using pull/{n}/head refspec (works for both fork and same-repo PRs)
    log.debug(`🌿 fetching PR #${pullNumber} (${localBranch})...`);
    $("git", ["fetch", "--no-tags", "origin", `pull/${pullNumber}/head:${localBranch}`]);

    // checkout the branch
    $("git", ["checkout", localBranch]);
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

    // add fork as a named remote (suppress logging to avoid "error: remote already exists" spam)
    try {
      $("git", ["remote", "add", remoteName, forkUrl], { log: false });
      log.debug(`📌 added remote '${remoteName}' for fork ${headRepo.full_name}`);
    } catch {
      // remote already exists, update its URL
      $("git", ["remote", "set-url", remoteName, forkUrl], { log: false });
      log.debug(`📌 updated remote '${remoteName}' for fork ${headRepo.full_name}`);
    }

    // set branch push config so `git push` knows where to push
    $("git", ["config", `branch.${localBranch}.pushRemote`, remoteName]);
    // set merge ref so git knows the remote branch name (may differ from local)
    $("git", ["config", `branch.${localBranch}.merge`, `refs/heads/${headBranch}`]);
    log.debug(`📌 configured branch '${localBranch}' to push to '${remoteName}/${headBranch}'`);

    // warn if maintainer can't modify (push will likely fail)
    if (!pr.data.maintainer_can_modify) {
      log.warning(
        `⚠️ fork PR has maintainer_can_modify=false - push operations will fail. ` +
          `ask the PR author to enable "Allow edits from maintainers" or the fork may be owned by an organization.`
      );
    }
  } else {
    // for same-repo PRs, push to origin
    $("git", ["config", `branch.${localBranch}.pushRemote`, "origin"]);
    $("git", ["config", `branch.${localBranch}.merge`, `refs/heads/${headBranch}`]);
  }

  return { prNumber: pullNumber };
}

export function CheckoutPrTool(ctx: ToolContext) {
  return tool({
    name: "checkout_pr",
    description:
      "Checkout a pull request branch locally. This fetches the PR branch and sets up push configuration for fork PRs. " +
      "Returns diffPath pointing to the formatted diff file.",
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

      // fetch PR files and format with line numbers
      const filesResponse = await ctx.octokit.rest.pulls.listFiles({
        owner: ctx.owner,
        repo: ctx.name,
        pull_number,
        per_page: 100,
      });
      const diffContent = formatFilesWithLineNumbers(filesResponse.data);
      const diffPreview = diffContent.split("\n").slice(0, 100).join("\n");
      log.debug(`formatted diff preview (first 100 lines):\n${diffPreview}`);
      const tempDir = process.env.PULLFROG_TEMP_DIR;
      if (!tempDir) {
        throw new Error(
          "PULLFROG_TEMP_DIR not set - checkout_pr must run in pullfrog action context"
        );
      }
      const diffPath = join(tempDir, `pr-${pull_number}.diff`);
      writeFileSync(diffPath, diffContent);
      log.debug(`wrote diff to ${diffPath} (${diffContent.length} bytes)`);

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
        diffPath,
      } satisfies CheckoutPrResult;
    }),
  });
}
