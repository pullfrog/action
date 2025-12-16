/**
 * ⚠️ NO IMPORTS except modes.ts - this file is imported by Next.js and must avoid pulling in backend code.
 * All shared constants, types, and data used by both the Next.js app and the action runtime live here.
 * Other files in action/ re-export from this file for backward compatibility.
 */

import { type } from "arktype";
import type { Mode } from "./modes.ts";

// mcp name constant
export const ghPullfrogMcpName = "gh_pullfrog";

export interface AgentManifest {
  displayName: string;
  apiKeyNames: string[];
  url: string;
}

// agent manifest - static metadata about available agents
export const agentsManifest = {
  claude: {
    displayName: "Claude Code",
    apiKeyNames: ["anthropic_api_key"],
    url: "https://claude.com/claude-code",
  },
  codex: {
    displayName: "Codex CLI",
    apiKeyNames: ["openai_api_key"],
    url: "https://platform.openai.com/docs/guides/codex",
  },
  cursor: {
    displayName: "Cursor CLI",
    apiKeyNames: ["cursor_api_key"],
    url: "https://cursor.com/",
  },
  gemini: {
    displayName: "Gemini CLI",
    apiKeyNames: ["google_api_key", "gemini_api_key"],
    url: "https://ai.google.dev/gemini-api/docs",
  },
  opencode: {
    displayName: "OpenCode",
    apiKeyNames: [], // empty array means OpenCode accepts any API_KEY from environment
    url: "https://opencode.ai",
  },
} as const satisfies Record<string, AgentManifest>;

// agent name type - union of agent slugs
export type AgentName = keyof typeof agentsManifest;
export const AgentName = type.enumerated(...Object.keys(agentsManifest));

export type AgentApiKeyName = (typeof agentsManifest)[AgentName]["apiKeyNames"][number];

// base interface for common payload event fields
interface BasePayloadEvent {
  issue_number?: number;
  is_pr?: boolean;
  branch?: string;
  pr_title?: string;
  pr_body?: string | null;
  issue_title?: string;
  issue_body?: string | null;
  comment_id?: number;
  comment_body?: string;
  review_id?: number;
  review_body?: string | null;
  review_state?: string;
  review_comments?: any[];
  context?: any;
  thread?: any;
  pull_request?: any;
  check_suite?: {
    id: number;
    head_sha: string;
    head_branch: string | null;
    status: string | null;
    conclusion: string | null;
    url: string;
  };
  comment_ids?: number[] | "all";
  [key: string]: any;
}

interface PullRequestOpenedEvent extends BasePayloadEvent {
  trigger: "pull_request_opened";
  issue_number: number;
  is_pr: true;
  pr_title: string;
  pr_body: string | null;
  branch: string;
}

interface PullRequestReadyForReviewEvent extends BasePayloadEvent {
  trigger: "pull_request_ready_for_review";
  issue_number: number;
  is_pr: true;
  pr_title: string;
  pr_body: string | null;
  branch: string;
}

interface PullRequestReviewRequestedEvent extends BasePayloadEvent {
  trigger: "pull_request_review_requested";
  issue_number: number;
  is_pr: true;
  pr_title: string;
  pr_body: string | null;
  branch: string;
}

interface PullRequestReviewSubmittedEvent extends BasePayloadEvent {
  trigger: "pull_request_review_submitted";
  issue_number: number;
  is_pr: true;
  review_id: number;
  review_body: string | null;
  review_state: string;
  review_comments: any[];
  context: any;
  branch: string;
}

interface PullRequestReviewCommentCreatedEvent extends BasePayloadEvent {
  trigger: "pull_request_review_comment_created";
  issue_number: number;
  is_pr: true;
  pr_title: string;
  comment_id: number;
  comment_body: string;
  thread?: any;
  branch: string;
}

interface IssuesOpenedEvent extends BasePayloadEvent {
  trigger: "issues_opened";
  issue_number: number;
  issue_title: string;
  issue_body: string | null;
}

interface IssuesAssignedEvent extends BasePayloadEvent {
  trigger: "issues_assigned";
  issue_number: number;
  issue_title: string;
  issue_body: string | null;
}

interface IssuesLabeledEvent extends BasePayloadEvent {
  trigger: "issues_labeled";
  issue_number: number;
  issue_title: string;
  issue_body: string | null;
}

interface IssueCommentCreatedEvent extends BasePayloadEvent {
  trigger: "issue_comment_created";
  comment_id: number;
  comment_body: string;
  issue_number: number;
  // PR-specific fields (only present when is_pr is true)
  is_pr?: true;
  branch?: string;
  pr_title?: string;
  pr_body?: string | null;
}

interface CheckSuiteCompletedEvent extends BasePayloadEvent {
  trigger: "check_suite_completed";
  issue_number: number;
  is_pr: true;
  pr_title: string;
  pr_body: string | null;
  pull_request: any;
  branch: string;
  check_suite: {
    id: number;
    head_sha: string;
    head_branch: string | null;
    status: string | null;
    conclusion: string | null;
    url: string;
  };
}

interface WorkflowDispatchEvent extends BasePayloadEvent {
  trigger: "workflow_dispatch";
}

interface FixReviewEvent extends BasePayloadEvent {
  trigger: "fix_review";
  issue_number: number;
  is_pr: true;
  review_id: number;
  /** "all" to fix all comments, or specific comment IDs to fix */
  comment_ids: number[] | "all";
  branch: string;
}

interface UnknownEvent extends BasePayloadEvent {
  trigger: "unknown";
}

// discriminated union for payload event based on trigger
// note: all events use issue_number for consistency (PRs are issues in GitHub's API)
export type PayloadEvent =
  | PullRequestOpenedEvent
  | PullRequestReadyForReviewEvent
  | PullRequestReviewRequestedEvent
  | PullRequestReviewSubmittedEvent
  | PullRequestReviewCommentCreatedEvent
  | IssuesOpenedEvent
  | IssuesAssignedEvent
  | IssuesLabeledEvent
  | IssueCommentCreatedEvent
  | CheckSuiteCompletedEvent
  | WorkflowDispatchEvent
  | FixReviewEvent
  | UnknownEvent;

export interface DispatchOptions {
  /**
   * Sandbox mode flag - when true, restricts agent to read-only operations
   * (no Write, Web, or Bash access)
   */
  readonly sandbox?: boolean;

  /**
   * When true, disables progress comment (no "leaping into action" comment, no report_progress tool)
   */
  readonly disableProgressComment?: true;
}

// payload type for agent execution
export interface Payload extends DispatchOptions {
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
   * Discriminated union based on trigger field.
   */
  readonly event: PayloadEvent;

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
}
