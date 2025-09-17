import type {
  IssuesEvent,
  IssuesAssignedEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
  WorkflowRunEvent,
} from "@octokit/webhooks-types";

// Custom types for GitHub Actions events that aren't webhooks
export type WorkflowDispatchEvent = {
  action?: never;
  inputs?: Record<string, any>;
  ref?: string;
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
  sender: {
    login: string;
  };
  workflow: string;
};

export type ScheduleEvent = {
  action?: never;
  schedule?: string;
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
};

// Event name constants for better maintainability
const ENTITY_EVENT_NAMES = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
] as const;

const AUTOMATION_EVENT_NAMES = [
  "workflow_dispatch",
  "schedule",
  "workflow_run",
] as const;

// Derive types from constants for better maintainability
type EntityEventName = (typeof ENTITY_EVENT_NAMES)[number];
type AutomationEventName = (typeof AUTOMATION_EVENT_NAMES)[number];

// Common fields shared by all context types
type BaseContext = {
  runId: string;
  eventAction?: string;
  repository: {
    owner: string;
    repo: string;
    full_name: string;
  };
  actor: string;
  inputs: {
    prompt: string;
    triggerPhrase: string;
    baseBranch?: string;
  };
};

// Context for entity-based events (issues, PRs, comments)
export type ParsedGitHubContext = BaseContext & {
  eventName: EntityEventName;
  payload:
    | IssuesEvent
    | IssueCommentEvent
    | PullRequestEvent
    | PullRequestReviewEvent
    | PullRequestReviewCommentEvent;
  entityNumber: number;
  isPR: boolean;
};

// Context for automation events (workflow_dispatch, schedule, workflow_run)
export type AutomationContext = BaseContext & {
  eventName: AutomationEventName;
  payload: WorkflowDispatchEvent | ScheduleEvent | WorkflowRunEvent;
};

// Union type for all contexts
export type GitHubContext = ParsedGitHubContext | AutomationContext;

export interface MockGitHubContext {
  eventName: string;
  actor: string;
  repo: {
    owner: string;
    repo: string;
  };
  payload: any;
  runId?: string;
}

export function parseGitHubContext(mockContext?: MockGitHubContext): GitHubContext {
  // Use mock context if provided (for testing), otherwise use real GitHub context
  let context: any;
  
  if (mockContext) {
    context = {
      eventName: mockContext.eventName,
      actor: mockContext.actor,
      repo: mockContext.repo,
      payload: mockContext.payload,
    };
  } else {
    // In real GitHub Actions, we'd import @actions/github
    // For now, we'll create a basic structure that can be overridden
    context = {
      eventName: process.env.GITHUB_EVENT_NAME || "workflow_dispatch",
      actor: process.env.GITHUB_ACTOR || "unknown",
      repo: {
        owner: process.env.GITHUB_REPOSITORY_OWNER || "unknown",
        repo: process.env.GITHUB_REPOSITORY?.split("/")[1] || "unknown",
      },
      payload: {},
    };
  }

  const commonFields = {
    runId: process.env.GITHUB_RUN_ID || mockContext?.runId || "test-run",
    eventAction: context.payload.action,
    repository: {
      owner: context.repo.owner,
      repo: context.repo.repo,
      full_name: `${context.repo.owner}/${context.repo.repo}`,
    },
    actor: context.actor,
    inputs: {
      prompt: process.env.INPUT_PROMPT || "",
      triggerPhrase: process.env.INPUT_TRIGGER_PHRASE || "@pullfrog",
      baseBranch: process.env.INPUT_BASE_BRANCH,
    },
  };

  switch (context.eventName) {
    case "issues": {
      const payload = context.payload as IssuesEvent;
      return {
        ...commonFields,
        eventName: "issues",
        payload,
        entityNumber: payload.issue?.number || 1,
        isPR: false,
      };
    }
    case "issue_comment": {
      const payload = context.payload as IssueCommentEvent;
      return {
        ...commonFields,
        eventName: "issue_comment",
        payload,
        entityNumber: payload.issue?.number || 1,
        isPR: Boolean(payload.issue?.pull_request),
      };
    }
    case "pull_request": {
      const payload = context.payload as PullRequestEvent;
      return {
        ...commonFields,
        eventName: "pull_request",
        payload,
        entityNumber: payload.pull_request?.number || 1,
        isPR: true,
      };
    }
    case "pull_request_review": {
      const payload = context.payload as PullRequestReviewEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review",
        payload,
        entityNumber: payload.pull_request?.number || 1,
        isPR: true,
      };
    }
    case "pull_request_review_comment": {
      const payload = context.payload as PullRequestReviewCommentEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review_comment",
        payload,
        entityNumber: payload.pull_request?.number || 1,
        isPR: true,
      };
    }
    case "workflow_dispatch": {
      return {
        ...commonFields,
        eventName: "workflow_dispatch",
        payload: context.payload as unknown as WorkflowDispatchEvent,
      };
    }
    case "schedule": {
      return {
        ...commonFields,
        eventName: "schedule",
        payload: context.payload as unknown as ScheduleEvent,
      };
    }
    case "workflow_run": {
      return {
        ...commonFields,
        eventName: "workflow_run",
        payload: context.payload as unknown as WorkflowRunEvent,
      };
    }
    default:
      throw new Error(`Unsupported event type: ${context.eventName}`);
  }
}

export function isIssuesEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssuesEvent } {
  return context.eventName === "issues";
}

export function isIssueCommentEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssueCommentEvent } {
  return context.eventName === "issue_comment";
}

export function isPullRequestEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestEvent } {
  return context.eventName === "pull_request";
}

export function isPullRequestReviewEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewEvent } {
  return context.eventName === "pull_request_review";
}

export function isPullRequestReviewCommentEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewCommentEvent } {
  return context.eventName === "pull_request_review_comment";
}

export function isIssuesAssignedEvent(
  context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssuesAssignedEvent } {
  return isIssuesEvent(context) && context.eventAction === "assigned";
}

// Type guard to check if context is an entity context (has entityNumber and isPR)
export function isEntityContext(
  context: GitHubContext,
): context is ParsedGitHubContext {
  return ENTITY_EVENT_NAMES.includes(context.eventName as EntityEventName);
}

// Type guard to check if context is an automation context
export function isAutomationContext(
  context: GitHubContext,
): context is AutomationContext {
  return AUTOMATION_EVENT_NAMES.includes(
    context.eventName as AutomationEventName,
  );
}