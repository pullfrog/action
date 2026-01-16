import { createOctokit, parseRepoContext } from "./github.ts";
import { getGitHubInstallationToken } from "./token.ts";
import { fetchWorkflowRunInfo } from "./workflowRun.ts";

/**
 * Get progress comment ID from environment variable or database.
 */
function getProgressCommentIdFromEnv(): number | null {
  const envCommentId = process.env.PULLFROG_PROGRESS_COMMENT_ID;
  if (envCommentId) {
    const parsed = parseInt(envCommentId, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

export async function reportErrorToComment({
  error,
  title,
}: {
  error: string;
  title?: string;
}): Promise<void> {
  const formattedError = title ? `${title}\n\n${error}` : error;

  // try to get comment ID from env var first, then from database if needed
  let commentId = getProgressCommentIdFromEnv();

  // if not in env var, try fetching from database using run ID
  if (!commentId) {
    const runId = process.env.GITHUB_RUN_ID;
    if (runId) {
      try {
        const workflowRunInfo = await fetchWorkflowRunInfo(runId);
        if (workflowRunInfo.progressCommentId) {
          const parsed = parseInt(workflowRunInfo.progressCommentId, 10);
          if (!Number.isNaN(parsed)) {
            commentId = parsed;
            // cache it in env var for future use
            process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
          }
        }
      } catch {
        // database fetch failed, continue without comment ID
      }
    }
  }

  // if no comment ID available, can't update comment
  if (!commentId) {
    return;
  }

  // update comment directly using GitHub API
  const repoContext = parseRepoContext();
  const octokit = createOctokit(getGitHubInstallationToken());

  await octokit.rest.issues.updateComment({
    owner: repoContext.owner,
    repo: repoContext.name,
    comment_id: commentId,
    body: formattedError,
  });
}
