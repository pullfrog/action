import type { AgentResult, ToolPermissions } from "../agents/shared.ts";
import type { MainResult } from "../main.ts";
import { log } from "./cli.ts";
import type { ResolvedPayload } from "./payload.ts";

/**
 * Compute tool permissions from inputs.
 * For run action, bash defaults to restricted for public repos when unset.
 */
export function resolvePermissions(params: {
  payload: ResolvedPayload;
  isPublicRepo: boolean;
}): ToolPermissions {
  return {
    web: params.payload.web ?? "enabled",
    search: params.payload.search ?? "enabled",
    write: params.payload.write ?? "enabled",
    bash: params.payload.bash ?? (params.isPublicRepo ? "restricted" : "enabled"),
  };
}

export async function handleAgentResult(result: AgentResult): Promise<MainResult> {
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Agent execution failed",
      output: result.output!,
    };
  }

  log.success("Task complete.");

  return {
    success: true,
    output: result.output || "",
  };
}
