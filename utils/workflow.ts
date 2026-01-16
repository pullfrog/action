import { log } from "./cli.ts";
import type { RepoData } from "./repoData.ts";
import { fetchWorkflowRunInfo } from "./workflowRun.ts";

/**
 * Resolve GitHub Actions workflow run context (runId, jobId, progress comment)
 */
export async function resolveRunId(
  repoData: RepoData
): Promise<{ runId: string; jobId: string | undefined }> {
  const runId = process.env.GITHUB_RUN_ID || "";

  if (runId) {
    const workflowRunInfo = await fetchWorkflowRunInfo(runId);
    if (workflowRunInfo.progressCommentId) {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
      log.info(`» using pre-created progress comment: ${workflowRunInfo.progressCommentId}`);
    }
  }

  let jobId: string | undefined;
  const jobName = process.env.GITHUB_JOB;
  if (jobName && runId) {
    const jobs = await repoData.octokit.rest.actions.listJobsForWorkflowRun({
      owner: repoData.owner,
      repo: repoData.name,
      run_id: parseInt(runId, 10),
    });
    const matchingJob = jobs.data.jobs.find((job) => job.name === jobName);
    if (matchingJob) {
      jobId = String(matchingJob.id);
      log.debug(`» found job ID: ${jobId}`);
    }
  }

  return { runId, jobId };
}
