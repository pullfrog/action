import { ensureProgressCommentUpdated } from "./mcp/comment.ts";
import { startMcpHttpServer, type ToolContext, type ToolState } from "./mcp/server.ts";
import { computeModes } from "./modes.ts";
import { resolveAgent } from "./utils/agent.ts";
import { validateApiKey } from "./utils/apiKeys.ts";
import { log } from "./utils/cli.ts";
import { reportErrorToComment } from "./utils/errorReport.ts";
import { createOctokit } from "./utils/github.ts";
import { resolveInstructions } from "./utils/instructions.ts";
import { normalizeEnv } from "./utils/normalizeEnv.ts";
import { resolvePayload } from "./utils/payload.ts";
import { resolveRepoData } from "./utils/repoData.ts";
import { handleAgentResult } from "./utils/run.ts";
import { createTempDirectory, setupGit } from "./utils/setup.ts";
import { Timer } from "./utils/timer.ts";
import { resolveInstallationToken } from "./utils/token.ts";
import { resolveRun } from "./utils/workflow.ts";

export { Inputs } from "./utils/payload.ts";

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(): Promise<MainResult> {
  // normalize env var names to uppercase (handles case-insensitive workflow files)
  normalizeEnv();

  // store original GITHUB_TOKEN
  process.env.ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  const timer = new Timer();
  await using tokenRef = await resolveInstallationToken();
  process.env.GITHUB_TOKEN = tokenRef.token;

  const octokit = createOctokit(tokenRef.token);
  const runInfo = await resolveRun({ octokit });
  const hasProgressComment = runInfo.workflowRunInfo.progressCommentId !== null;

  try {
    const repo = await resolveRepoData({ octokit, token: tokenRef.token });
    timer.checkpoint("repoData");

    // resolve payload after repoData so permissions can use DB settings
    // precedence: action inputs > json payload > repoSettings > fallbacks
    const payload = resolvePayload(repo.repoSettings);
    if (payload.cwd && process.cwd() !== payload.cwd) {
      process.chdir(payload.cwd);
    }

    const tmpdir = await createTempDirectory();

    const agent = resolveAgent({ payload, repoSettings: repo.repoSettings });

    validateApiKey({
      agent,
      owner: repo.owner,
      name: repo.name,
    });

    const toolState: ToolState = {};
    await setupGit({
      token: tokenRef.token,
      owner: repo.owner,
      name: repo.name,
      event: payload.event,
      octokit,
      toolState,
    });
    timer.checkpoint("git");

    const modes = [...computeModes({ hasProgressComment }), ...repo.repoSettings.modes];

    const toolContext: ToolContext = {
      repo,
      payload,
      octokit,
      githubInstallationToken: tokenRef.token,
      agent,
      modes,
      toolState,
      runId: runInfo.runId,
      jobId: runInfo.jobId,
      hasProgressComment,
    };

    await using mcpHttpServer = await startMcpHttpServer(toolContext);
    log.info(`» MCP server started at ${mcpHttpServer.url}`);
    timer.checkpoint("mcpServer");

    const instructions = resolveInstructions({
      prompt: payload.prompt,
      event: payload.event,
      repoData: repo,
      modes,
      bash: payload.bash,
    });

    const result = await agent.run({
      payload,
      mcpServerUrl: mcpHttpServer.url,
      tmpdir,
      instructions,
    });
    const mainResult = await handleAgentResult(result);
    return mainResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    try {
      await reportErrorToComment({ error: errorMessage });
    } catch {
      // error reporting failed, but don't let it mask the original error
    }
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    // ensure progress comment is updated if it was never updated during execution
    // do this before revoking the token so we can still make API calls
    try {
      await ensureProgressCommentUpdated({ hasProgressComment });
    } catch {
      // error updating comment, but don't let it mask the original error
    }
  }
}
