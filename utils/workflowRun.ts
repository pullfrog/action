export interface WorkflowRunInfo {
  progressCommentId: string | null;
  issueNumber: number | null;
}

/**
 * Fetch workflow run info from the Pullfrog API
 * Returns the pre-created progress comment ID if one exists
 */
export async function fetchWorkflowRunInfo(runId: string): Promise<WorkflowRunInfo> {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/api/workflow-run/${runId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { progressCommentId: null, issueNumber: null };
    }

    const data = (await response.json()) as WorkflowRunInfo;
    return data;
  } catch {
    clearTimeout(timeoutId);
    return { progressCommentId: null, issueNumber: null };
  }
}
