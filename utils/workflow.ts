import { log } from "./cli.ts";
import type { OctokitWithPlugins } from "./github.ts";
import { fetchWorkflowRunInfo, type WorkflowRunInfo } from "./workflowRun.ts";

interface ResolveRunParams {
  octokit: OctokitWithPlugins;
}

export interface ResolveRunResult {
  runId: string;
  jobId: string | undefined;
  workflowRunInfo: WorkflowRunInfo;
}

/**
 * Resolve GitHub Actions workflow run context.
 * Uses GITHUB_REPOSITORY and GITHUB_RUN_ID env vars.
 */
export async function resolveRun(params: ResolveRunParams): Promise<ResolveRunResult> {
  const runId = process.env.GITHUB_RUN_ID || "";
  const githubRepo = process.env.GITHUB_REPOSITORY;
  if (!githubRepo || !githubRepo.includes("/")) {
    throw new Error(`GITHUB_REPOSITORY env var must be set to "owner/repo", got: ${githubRepo}`);
  }
  const [owner, repo] = githubRepo.split("/");

  const workflowRunInfo = runId ? await fetchWorkflowRunInfo(runId) : { progressCommentId: null };

  if (workflowRunInfo.progressCommentId) {
    process.env.PULLFROG_PROGRESS_COMMENT_ID = workflowRunInfo.progressCommentId;
    log.info(`» using pre-created progress comment: ${workflowRunInfo.progressCommentId}`);
  }

  let jobId: string | undefined;
  const jobName = process.env.GITHUB_JOB;
  if (jobName && runId) {
    const jobs = await params.octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: parseInt(runId, 10),
    });
    const matchingJob = jobs.data.jobs.find((job) => job.name === jobName);
    if (matchingJob) {
      jobId = String(matchingJob.id);
      log.debug(`» found job ID: ${jobId}`);
    }
  }

  return { runId, jobId, workflowRunInfo };
}
