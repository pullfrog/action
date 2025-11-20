import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const GetCheckSuiteLogs = type({
  check_suite_id: type.number.describe("the id from check_suite.id"),
});

export const GetCheckSuiteLogsTool = tool({
  name: "get_check_suite_logs",
  description:
    "get workflow run logs for a failed check suite. pass check_suite.id from the webhook payload.",
  parameters: GetCheckSuiteLogs,
  execute: contextualize(async ({ check_suite_id }, ctx) => {
    // get workflow runs for this specific check suite
    const workflowRuns = await ctx.octokit.paginate(
      ctx.octokit.rest.actions.listWorkflowRunsForRepo,
      {
        owner: ctx.owner,
        repo: ctx.name,
        check_suite_id,
        per_page: 100,
      }
    );

    const failedRuns = workflowRuns.filter((run) => run.conclusion === "failure");

    if (failedRuns.length === 0) {
      return {
        check_suite_id,
        message: "no failed workflow runs found for this check suite",
        workflow_runs: [],
      };
    }

    // get logs for each failed run
    const logsForRuns = await Promise.all(
      failedRuns.map(async (run) => {
        const jobs = await ctx.octokit.paginate(ctx.octokit.rest.actions.listJobsForWorkflowRun, {
          owner: ctx.owner,
          repo: ctx.name,
          run_id: run.id,
        });

        const jobLogs = await Promise.all(
          jobs.map(async (job) => {
            try {
              const logsResponse = await ctx.octokit.rest.actions.downloadJobLogsForWorkflowRun({
                owner: ctx.owner,
                repo: ctx.name,
                job_id: job.id,
              });

              const logsUrl = logsResponse.url;
              const logsText = await fetch(logsUrl).then((r) => r.text());

              return {
                job_id: job.id,
                job_name: job.name,
                status: job.status,
                conclusion: job.conclusion,
                started_at: job.started_at,
                completed_at: job.completed_at,
                logs: logsText,
              };
            } catch (error) {
              return {
                job_id: job.id,
                job_name: job.name,
                status: job.status,
                conclusion: job.conclusion,
                started_at: job.started_at,
                completed_at: job.completed_at,
                error: `failed to fetch logs: ${error}`,
              };
            }
          })
        );

        return {
          workflow_run_id: run.id,
          workflow_name: run.name,
          html_url: run.html_url,
          conclusion: run.conclusion,
          jobs: jobLogs,
        };
      })
    );

    return {
      check_suite_id,
      workflow_runs: logsForRuns,
    };
  }),
});
