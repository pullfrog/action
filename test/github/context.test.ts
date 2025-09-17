import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseGitHubContext, isEntityContext, isAutomationContext, isIssuesEvent, isIssueCommentEvent, isPullRequestEvent, isPullRequestReviewCommentEvent } from "../../github/context.ts";
import { createIssueCommentContext, createPullRequestContext, createIssueContext, createWorkflowDispatchContext, createPullRequestReviewCommentContext } from "../utils/mockContext.ts";

describe("GitHub Context Parsing", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("parseGitHubContext", () => {
    it("should parse issue comment context correctly", () => {
      const mockContext = createIssueCommentContext();
      const result = parseGitHubContext(mockContext);

      expect(result.eventName).toBe("issue_comment");
      expect(result.actor).toBe("developer123");
      expect(result.repository.full_name).toBe("acme/my-project");
      expect(result.inputs.triggerPhrase).toBe("@pullfrog");
      
      if (isEntityContext(result)) {
        expect(result.entityNumber).toBe(42);
        expect(result.isPR).toBe(false);
      }
    });

    it("should parse pull request context correctly", () => {
      const mockContext = createPullRequestContext();
      const result = parseGitHubContext(mockContext);

      expect(result.eventName).toBe("pull_request");
      expect(result.actor).toBe("contributor456");
      expect(result.repository.full_name).toBe("acme/my-project");
      
      if (isEntityContext(result)) {
        expect(result.entityNumber).toBe(15);
        expect(result.isPR).toBe(true);
      }
    });

    it("should parse workflow_dispatch context correctly", () => {
      const mockContext = createWorkflowDispatchContext();
      const result = parseGitHubContext(mockContext);

      expect(result.eventName).toBe("workflow_dispatch");
      expect(result.actor).toBe("admin-user");
      expect(result.repository.full_name).toBe("acme/my-project");
      expect(isAutomationContext(result)).toBe(true);
    });

    it("should handle environment variables for inputs", () => {
      process.env.INPUT_PROMPT = "test prompt";
      process.env.INPUT_TRIGGER_PHRASE = "@custom";
      process.env.INPUT_BASE_BRANCH = "develop";

      const mockContext = createIssueCommentContext();
      const result = parseGitHubContext(mockContext);

      expect(result.inputs.prompt).toBe("test prompt");
      expect(result.inputs.triggerPhrase).toBe("@custom");
      expect(result.inputs.baseBranch).toBe("develop");
    });

    it("should default to environment values when no mock context provided", () => {
      process.env.GITHUB_EVENT_NAME = "workflow_dispatch";
      process.env.GITHUB_ACTOR = "test-actor";
      process.env.GITHUB_REPOSITORY = "test-owner/test-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "test-owner";
      process.env.GITHUB_RUN_ID = "test-run-id";

      const result = parseGitHubContext();

      expect(result.eventName).toBe("workflow_dispatch");
      expect(result.actor).toBe("test-actor");
      expect(result.repository.owner).toBe("test-owner");
      expect(result.repository.repo).toBe("test-repo");
      expect(result.runId).toBe("test-run-id");
    });

    it("should handle issue comment with PR context", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          issue: {
            ...createIssueCommentContext().payload.issue,
            pull_request: { url: "https://api.github.com/repos/acme/my-project/pulls/42" },
          },
        },
      });

      const result = parseGitHubContext(mockContext);
      
      if (isEntityContext(result)) {
        expect(result.isPR).toBe(true);
      }
    });
  });

  describe("Type Guards", () => {
    it("should correctly identify entity contexts", () => {
      const issueContext = parseGitHubContext(createIssueContext());
      const prContext = parseGitHubContext(createPullRequestContext());
      const commentContext = parseGitHubContext(createIssueCommentContext());
      const workflowContext = parseGitHubContext(createWorkflowDispatchContext());

      expect(isEntityContext(issueContext)).toBe(true);
      expect(isEntityContext(prContext)).toBe(true);
      expect(isEntityContext(commentContext)).toBe(true);
      expect(isEntityContext(workflowContext)).toBe(false);
    });

    it("should correctly identify automation contexts", () => {
      const workflowContext = parseGitHubContext(createWorkflowDispatchContext());
      const issueContext = parseGitHubContext(createIssueContext());

      expect(isAutomationContext(workflowContext)).toBe(true);
      expect(isAutomationContext(issueContext)).toBe(false);
    });

    it("should correctly identify specific event types", () => {
      const issueContext = parseGitHubContext(createIssueContext());
      const commentContext = parseGitHubContext(createIssueCommentContext());
      const prContext = parseGitHubContext(createPullRequestContext());
      const reviewCommentContext = parseGitHubContext(createPullRequestReviewCommentContext());

      expect(isIssuesEvent(issueContext)).toBe(true);
      expect(isIssuesEvent(commentContext)).toBe(false);

      expect(isIssueCommentEvent(commentContext)).toBe(true);
      expect(isIssueCommentEvent(issueContext)).toBe(false);

      expect(isPullRequestEvent(prContext)).toBe(true);
      expect(isPullRequestEvent(issueContext)).toBe(false);

      expect(isPullRequestReviewCommentEvent(reviewCommentContext)).toBe(true);
      expect(isPullRequestReviewCommentEvent(prContext)).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for unsupported event types", () => {
      const mockContext = {
        eventName: "unsupported_event",
        actor: "test-actor",
        repo: { owner: "test", repo: "test" },
        payload: {},
      };

      expect(() => parseGitHubContext(mockContext)).toThrow("Unsupported event type: unsupported_event");
    });
  });

  describe("Payload Data Extraction", () => {
    it("should extract issue data correctly", () => {
      const mockContext = createIssueContext();
      const result = parseGitHubContext(mockContext);

      if (isIssuesEvent(result)) {
        expect(result.payload.issue.title).toBe("Memory leak in authentication middleware");
        expect(result.payload.issue.number).toBe(87);
        expect(result.payload.issue.labels).toHaveLength(3);
        expect(result.payload.issue.labels[0].name).toBe("bug");
      }
    });

    it("should extract PR data correctly", () => {
      const mockContext = createPullRequestContext();
      const result = parseGitHubContext(mockContext);

      if (isPullRequestEvent(result)) {
        expect(result.payload.pull_request.title).toBe("Implement JWT authentication system");
        expect(result.payload.pull_request.number).toBe(15);
        expect(result.payload.pull_request.base.ref).toBe("main");
        expect(result.payload.pull_request.head.ref).toBe("feature/jwt-auth");
      }
    });

    it("should extract comment data correctly", () => {
      const mockContext = createIssueCommentContext();
      const result = parseGitHubContext(mockContext);

      if (isIssueCommentEvent(result)) {
        expect(result.payload.comment.body).toContain("@pullfrog please create");
        expect(result.payload.comment.user.login).toBe("developer123");
        expect(result.payload.issue.title).toBe("Add user authentication feature");
      }
    });
  });
});