/**
 * ⚠️ LIMITED IMPORTS - this file is imported by Next.js and must avoid pulling in backend code.
 * All shared constants, types, and data used by both the Next.js app and the action runtime live here.
 * Other files in action/ re-export from this file for backward compatibility.
 */

import { type } from "arktype";

// mcp name constant
export const ghPullfrogMcpName = "gh_pullfrog";

export interface AgentManifest {
  displayName: string;
  /** empty array means accepts any *API_KEY* env var */
  apiKeyNames: string[];
  url: string;
}

// agent manifest - static metadata about available agents
export const agentsManifest = {
  claude: {
    displayName: "Claude Code",
    apiKeyNames: ["ANTHROPIC_API_KEY"],
    url: "https://claude.com/claude-code",
  },
  codex: {
    displayName: "Codex CLI",
    apiKeyNames: ["OPENAI_API_KEY"],
    url: "https://platform.openai.com/docs/guides/codex",
  },
  cursor: {
    displayName: "Cursor CLI",
    apiKeyNames: ["CURSOR_API_KEY"],
    url: "https://cursor.com/",
  },
  gemini: {
    displayName: "Gemini CLI",
    apiKeyNames: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    url: "https://ai.google.dev/gemini-api/docs",
  },
  opencode: {
    displayName: "OpenCode",
    apiKeyNames: [],
    url: "https://opencode.ai",
  },
} as const satisfies Record<string, AgentManifest>;

// agent name type - union of agent slugs
export type AgentName = keyof typeof agentsManifest;
export const AgentName = type.enumerated(...Object.keys(agentsManifest));

export type AgentApiKeyName = (typeof agentsManifest)[AgentName]["apiKeyNames"][number];

// effort level type - controls model selection and thinking level
// mini = fast/minimal, auto = balanced/default, max = maximum capability
export const Effort = type.enumerated("mini", "auto", "max");
export type Effort = typeof Effort.infer;

// tool permission types shared with server dispatch
export type ToolPermission = "disabled" | "enabled";
export type BashPermission = "disabled" | "restricted" | "enabled";

// permission level for the author who triggered the event
// matches GitHub's permission levels: admin > write > maintain > triage > read > none
export type AuthorPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

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
  /** permission level of the user who triggered this event */
  authorPermission?: AuthorPermission;
  /** when true, runs silently without progress comments (e.g., auto-labeling) */
  silent?: boolean;
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
  /** username of the person who triggered this action - use with get_review_comments approved_by */
  triggerer: string;
}

interface ImplementPlanEvent extends BasePayloadEvent {
  trigger: "implement_plan";
  issue_number: number;
  plan_comment_id: number;
  plan_content: string;
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
  | ImplementPlanEvent
  | UnknownEvent;

// writeable payload type for building payloads
export interface WriteablePayload {
  "~pullfrog": true;
  /** agent slug identifier (e.g., "claude", "codex", "gemini") */
  agent: AgentName | null;
  /** the prompt/instructions for the agent to execute */
  prompt: string;
  /** event data from webhook payload - discriminated union based on trigger field */
  event: PayloadEvent;
  /** effort level for model selection (mini, auto, max) - defaults to "auto" */
  effort?: Effort | undefined;
  /** working directory for the agent */
  cwd?: string | null | undefined;
}

// immutable payload type for agent execution
export type Payload = Readonly<WriteablePayload>;
