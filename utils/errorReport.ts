import { log } from "./cli.ts";
import { reportProgress } from "../mcp/comment.ts";
import { getMcpContext } from "../mcp/shared.ts";

/**
 * Check if MCP context is initialized (i.e., MCP server has started)
 */
function isMcpContextInitialized(): boolean {
  try {
    getMcpContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Report an error to the GitHub working comment.
 * Formats the error message for GitHub markdown and updates the progress comment.
 * Handles failures gracefully - logs but doesn't throw.
 */
export async function reportErrorToComment({
  error,
  title,
}: {
  error: string;
  title?: string;
}): Promise<void> {
  // only report if MCP context is initialized (MCP server has started)
  if (!isMcpContextInitialized()) {
    log.debug("skipping error comment update: MCP context not initialized");
    return;
  }

  try {
    const formattedError = title ? `${title}\n\n${error}` : `❌ ${error}`;
    await reportProgress({ body: formattedError });
  } catch (reportError) {
    // log but don't throw - we don't want error reporting to fail the workflow
    const errorMessage =
      reportError instanceof Error ? reportError.message : String(reportError);
    log.warning(`failed to report error to comment: ${errorMessage}`);
  }
}

