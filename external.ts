import type { AgentName } from "./main.ts";
import type { Mode } from "./modes.ts";

export type Payload = {
  "~pullfrog": true;

  /**
   * Agent slug identifier (e.g., "claude", "codex", "gemini")
   */
  readonly agent: AgentName | null;

  /**
   * The prompt/instructions for the agent to execute
   */
  readonly prompt: string;

  /**
   * Event data from webhook payload.
   */
  readonly event: object;

  /**
   * Execution mode configuration
   */
  modes: readonly Mode[];

  /**
   * Optional IDs of the issue, PR, or comment that the agent is working on
   */
  readonly comment_id?: number | null;
  readonly issue_id?: number | null;
  readonly pr_id?: number | null;
};
