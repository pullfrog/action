/**
 * ⚠️ NO IMPORTS except modes.ts - this file is imported by Next.js and must avoid pulling in backend code.
 * All shared constants, types, and data used by both the Next.js app and the action runtime live here.
 * Other files in action/ re-export from this file for backward compatibility.
 */

import type { Mode } from "./modes.ts";

// mcp name constant
export const ghPullfrogMcpName = "gh-pullfrog";

// agent manifest - static metadata about available agents
export const agentsManifest = {
  claude: {
    name: "claude",
    apiKeys: ["anthropic_api_key"],
  },
  codex: {
    name: "codex",
    apiKeys: ["openai_api_key"],
  },
  cursor: {
    name: "cursor",
    apiKeys: ["cursor_api_key"],
  },
  gemini: {
    name: "gemini",
    apiKeys: ["google_api_key", "gemini_api_key"],
  },
} as const;

// agent name type - union of agent slugs
export type AgentName = keyof typeof agentsManifest;

// payload type for agent execution
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
