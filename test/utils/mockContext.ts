import type { MockGitHubContext } from "../../github/context.ts";
import type {
  IssuesEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
} from "@octokit/webhooks-types";

/**
 * Mock context factory functions for testing GitHub event handling
 */
export function createIssueCommentContext(overrides: Partial<MockGitHubContext> = {}): MockGitHubContext {
  return {
    eventName: "issue_comment",
    actor: "developer123",
    repo: {
      owner: "acme",
      repo: "my-project",
    },
    runId: "12345",
    payload: {
      action: "created",
      issue: {
        number: 42,
        title: "Add user authentication feature",
        body: "We need to implement user authentication with JWT tokens. This should include login, logout, and token refresh functionality.",
        state: "open",
        created_at: "2024-01-15T10:30:00Z",
        labels: [
          { id: 1, name: "enhancement", color: "a2eeef" },
          { id: 2, name: "high-priority", color: "d73a4a" },
        ],
        assignees: [
          { id: 1, login: "lead-dev", type: "User" },
        ],
        user: {
          id: 1,
          login: "product-manager",
          type: "User",
        },
        pull_request: null,
      },
      comment: {
        id: 1,
        body: "@pullfrog please create a detailed implementation plan for the authentication feature. Include security considerations and testing approach.",
        user: {
          id: 2,
          login: "developer123",
          type: "User",
        },
        created_at: "2024-01-15T14:20:00Z",
      },
    } as IssueCommentEvent,
    ...overrides,
  };
}

export function createPullRequestContext(overrides: Partial<MockGitHubContext> = {}): MockGitHubContext {
  return {
    eventName: "pull_request",
    actor: "contributor456",
    repo: {
      owner: "acme",
      repo: "my-project",
    },
    runId: "67890",
    payload: {
      action: "opened",
      pull_request: {
        id: 1,
        number: 15,
        title: "Implement JWT authentication system",
        body: "This PR implements the JWT authentication system requested in #42.\n\nChanges include:\n- Login/logout endpoints\n- JWT token generation and validation\n- Middleware for protected routes\n- Unit tests for auth functionality\n\nCloses #42",
        state: "open",
        draft: false,
        mergeable: true,
        base: {
          ref: "main",
          sha: "abc123def456",
          repo: {
            id: 1,
            name: "my-project",
            full_name: "acme/my-project",
          },
        },
        head: {
          ref: "feature/jwt-auth",
          sha: "def456ghi789",
          repo: {
            id: 1,
            name: "my-project",
            full_name: "acme/my-project",
          },
        },
        labels: [
          { id: 1, name: "enhancement", color: "a2eeef" },
          { id: 2, name: "auth", color: "0052cc" },
        ],
        assignees: [
          { id: 1, login: "contributor456", type: "User" },
        ],
        user: {
          id: 1,
          login: "contributor456",
          type: "User",
        },
        created_at: "2024-01-16T09:15:00Z",
      },
    } as PullRequestEvent,
    ...overrides,
  };
}

export function createPullRequestReviewCommentContext(overrides: Partial<MockGitHubContext> = {}): MockGitHubContext {
  return {
    eventName: "pull_request_review_comment",
    actor: "senior-dev",
    repo: {
      owner: "acme",
      repo: "my-project",
    },
    runId: "11111",
    payload: {
      action: "created",
      pull_request: {
        id: 1,
        number: 15,
        title: "Implement JWT authentication system",
        body: "This PR implements the JWT authentication system requested in #42.\n\nChanges include:\n- Login/logout endpoints\n- JWT token generation and validation\n- Middleware for protected routes\n- Unit tests for auth functionality\n\nCloses #42",
        state: "open",
        base: {
          ref: "main",
          repo: {
            id: 1,
            name: "my-project",
            full_name: "acme/my-project",
          },
        },
        head: {
          ref: "feature/jwt-auth",
          repo: {
            id: 1,
            name: "my-project", 
            full_name: "acme/my-project",
          },
        },
      },
      comment: {
        id: 1,
        body: "@pullfrog this token validation logic looks concerning. Can you review the security implications and suggest improvements?",
        user: {
          id: 1,
          login: "senior-dev",
          type: "User",
        },
        path: "src/auth/jwt.ts",
        line: 45,
        created_at: "2024-01-16T11:30:00Z",
        diff_hunk: "@@ -42,6 +42,10 @@ export function validateToken(token: string): User | null {\n   try {\n     const decoded = jwt.verify(token, process.env.JWT_SECRET);\n+    if (!decoded || typeof decoded !== 'object') {\n+      return null;\n+    }\n     return decoded as User;\n   } catch (error) {\n     return null;",
      },
    } as PullRequestReviewCommentEvent,
    ...overrides,
  };
}

export function createIssueContext(overrides: Partial<MockGitHubContext> = {}): MockGitHubContext {
  return {
    eventName: "issues",
    actor: "bug-reporter",
    repo: {
      owner: "acme",
      repo: "my-project",
    },
    runId: "33333",
    payload: {
      action: "opened",
      issue: {
        id: 1,
        number: 87,
        title: "Memory leak in authentication middleware",
        body: "I've noticed a memory leak in the JWT authentication middleware. Memory usage keeps growing over time.\n\n@pullfrog can you investigate this memory leak and suggest a fix? Please also add monitoring to prevent this in the future.\n\nSteps to reproduce:\n1. Start the server\n2. Make repeated authenticated requests\n3. Monitor memory usage over time\n\nExpected: Stable memory usage\nActual: Memory keeps growing until server crashes",
        state: "open",
        created_at: "2024-01-17T08:45:00Z",
        labels: [
          { id: 1, name: "bug", color: "d73a4a" },
          { id: 2, name: "critical", color: "b60205" },
          { id: 3, name: "memory-leak", color: "0052cc" },
        ],
        assignees: [],
        user: {
          id: 1,
          login: "bug-reporter",
          type: "User",
        },
      },
    } as IssuesEvent,
    ...overrides,
  };
}

export function createWorkflowDispatchContext(overrides: Partial<MockGitHubContext> = {}): MockGitHubContext {
  return {
    eventName: "workflow_dispatch",
    actor: "admin-user",
    repo: {
      owner: "acme",
      repo: "my-project",
    },
    runId: "22222",
    payload: {
      inputs: {
        task: "code-review",
        target_branch: "feature/jwt-auth",
        focus_areas: "security,performance,testing",
        custom_prompt: "Please perform a comprehensive security review of the authentication system, focusing on JWT implementation and potential vulnerabilities.",
      },
      ref: "refs/heads/main",
      repository: {
        name: "my-project",
        owner: {
          login: "acme",
        },
      },
      sender: {
        login: "admin-user",
      },
      workflow: "claude-automation.yml",
    },
    ...overrides,
  };
}

/**
 * Common test data constants
 */
export const TEST_REPO = {
  owner: "acme",
  repo: "my-project",
  full_name: "acme/my-project",
};

export const TEST_USERS = {
  DEVELOPER: { id: 1, login: "developer123", type: "User" as const },
  CONTRIBUTOR: { id: 2, login: "contributor456", type: "User" as const },
  SENIOR_DEV: { id: 3, login: "senior-dev", type: "User" as const },
  BUG_REPORTER: { id: 4, login: "bug-reporter", type: "User" as const },
  ADMIN: { id: 5, login: "admin-user", type: "User" as const },
};

export const TEST_LABELS = {
  ENHANCEMENT: { id: 1, name: "enhancement", color: "a2eeef" },
  HIGH_PRIORITY: { id: 2, name: "high-priority", color: "d73a4a" },
  AUTH: { id: 3, name: "auth", color: "0052cc" },
  BUG: { id: 4, name: "bug", color: "d73a4a" },
  CRITICAL: { id: 5, name: "critical", color: "b60205" },
  MEMORY_LEAK: { id: 6, name: "memory-leak", color: "0052cc" },
};