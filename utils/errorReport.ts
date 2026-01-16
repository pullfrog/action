import type { ToolState } from "../mcp/server.ts";
import { createOctokit, parseRepoContext } from "./github.ts";
import { getGitHubInstallationToken } from "./token.ts";

interface ReportErrorParams {
  toolState: ToolState;
  error: string;
  title?: string;
}

export async function reportErrorToComment(ctx: ReportErrorParams): Promise<void> {
  const formattedError = ctx.title ? `${ctx.title}\n\n${ctx.error}` : ctx.error;

  const commentId = ctx.toolState.progressComment.id;
  if (!commentId) {
    return;
  }

  const repoContext = parseRepoContext();
  const octokit = createOctokit(getGitHubInstallationToken());

  await octokit.rest.issues.updateComment({
    owner: repoContext.owner,
    repo: repoContext.name,
    comment_id: commentId,
    body: formattedError,
  });
}
