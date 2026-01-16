import { ensureProgressCommentUpdated } from "./mcp/comment.ts";
import { startMcpHttpServer, type ToolContext, type ToolState } from "./mcp/server.ts";
import { computeModes } from "./modes.ts";
import { validateApiKey } from "./utils/apiKeys.ts";
import { log } from "./utils/cli.ts";
import { reportErrorToComment } from "./utils/errorReport.ts";
import { resolveInstructions } from "./utils/instructions.ts";
import { normalizeEnv } from "./utils/normalizeEnv.ts";
import { resolvePayload } from "./utils/payload.ts";
import { resolveRepoData } from "./utils/repoData.ts";
import { resolveAgent } from "./utils/resolveAgent.ts";
import { handleAgentResult, resolvePermissions } from "./utils/run.ts";
import { createTempDirectory, setupGit } from "./utils/setup.ts";
import { Timer } from "./utils/timer.ts";
import { resolveInstallationToken } from "./utils/token.ts";
import { resolveRunId } from "./utils/workflow.ts";

export { Inputs } from "./utils/payload.ts";

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(core: {
  getInput: (name: string, options?: { required?: boolean }) => string;
}): Promise<MainResult> {
  // normalize env var names to uppercase (handles case-insensitive workflow files)
  normalizeEnv();

  // store original GITHUB_TOKEN
  process.env.ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  const payload = resolvePayload(core);
  if (payload.cwd && process.cwd() !== payload.cwd) {
    process.chdir(payload.cwd);
  }

  const timer = new Timer();
  await using tokenRef = await resolveInstallationToken();
  process.env.GITHUB_TOKEN = tokenRef.token;

  try {
    const repoData = await resolveRepoData(tokenRef.token);
    const tmpdir = await createTempDirectory();
    timer.checkpoint("repoData");

    const agent = resolveAgent({ payload, repoSettings: repoData.repoSettings });

    const { apiKey, apiKeys } = validateApiKey({
      agent,
      owner: repoData.owner,
      name: repoData.name,
    });

    // compute tool permissions early
    const tools = resolvePermissions({
      payload,
      isPublicRepo: !repoData.repo.private,
    });

    const toolState: ToolState = {};
    await setupGit({
      token: tokenRef.token,
      owner: repoData.owner,
      name: repoData.name,
      event: payload.event,
      octokit: repoData.octokit,
      toolState,
    });
    timer.checkpoint("git");

    const modes = [
      ...computeModes({ disableProgressComment: payload.disableProgressComment }),
      ...repoData.repoSettings.modes,
    ];
    const { runId, jobId } = await resolveRunId(repoData);

    const toolContext: ToolContext = {
      owner: repoData.owner,
      name: repoData.name,
      repo: { default_branch: repoData.repo.default_branch, private: repoData.repo.private },
      githubInstallationToken: tokenRef.token,
      octokit: repoData.octokit,
      agent,
      event: payload.event,
      disableProgressComment: payload.disableProgressComment,
      modes,
      toolState,
      runId,
      jobId,
      tools,
    };

    await using mcpHttpServer = await startMcpHttpServer(toolContext);
    log.info(`» MCP server started at ${mcpHttpServer.url}`);
    timer.checkpoint("mcpServer");

    const instructions = resolveInstructions({
      prompt: payload.prompt,
      event: payload.event,
      repoData,
      modes,
      bash: tools.bash,
    });

    const result = await agent.run({
      effort: payload.effort,
      tools,
      mcpServerUrl: mcpHttpServer.url,
      tmpdir,
      instructions,
      apiKey,
      apiKeys,
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
      await ensureProgressCommentUpdated({
        disableProgressComment: payload.disableProgressComment,
      });
    } catch {
      // error updating comment, but don't let it mask the original error
    }
  }
}
