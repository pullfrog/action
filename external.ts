/**
 * ⚠️ NO IMPORTS except modes.ts - this file is imported by Next.js and must avoid pulling in backend code.
 * All shared constants, types, and data used by both the Next.js app and the action runtime live here.
 * Other files in action/ re-export from this file for backward compatibility.
 */

import type { Mode } from "./modes.ts";

// mcp name constant
export const ghPullfrogMcpName = "gh_pullfrog";

export interface AgentManifest {
  displayName: string;
  apiKeyNames: string[];
}

// agent manifest - static metadata about available agents
export const agentsManifest = {
  claude: {
    displayName: "Claude Code",
    apiKeyNames: ["anthropic_api_key"],
  },
  codex: {
    displayName: "Codex CLI",
    apiKeyNames: ["openai_api_key"],
  },
  cursor: {
    displayName: "Cursor CLI",
    apiKeyNames: ["cursor_api_key"],
  },
  gemini: {
    displayName: "Gemini CLI",
    apiKeyNames: ["google_api_key", "gemini_api_key"],
  },
} as const satisfies Record<string, AgentManifest>;

// agent name type - union of agent slugs
export type AgentName = keyof typeof agentsManifest;

export type AgentApiKeyName = (typeof agentsManifest)[AgentName]["apiKeyNames"][number];

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
   * Can be an object (will be JSON.stringify'd) or a string (used as-is).
   */
  readonly event: object | string;

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
