import { describe, it, expect } from "vitest";
import { enhancePromptWithContext, extractTriggerPrompt } from "../../github/prompt-enhancer.ts";
import { parseGitHubContext } from "../../github/context.ts";
import { createIssueCommentContext, createPullRequestContext, createIssueContext, createWorkflowDispatchContext, createPullRequestReviewCommentContext } from "../utils/mockContext.ts";

describe("Prompt Enhancement", () => {
  describe("enhancePromptWithContext", () => {
    it("should enhance prompt with issue comment context", () => {
      const basePrompt = "Please help with this issue";
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.originalPrompt).toBe(basePrompt);
      expect(result.contextualPrompt).toContain(basePrompt);
      expect(result.contextualPrompt).toContain("## GitHub Context");
      expect(result.contextualPrompt).toContain("**Repository:** acme/my-project");
      expect(result.contextualPrompt).toContain("**Event:** issue_comment");
      expect(result.contextualPrompt).toContain("**Issue:** #42");
      expect(result.contextualPrompt).toContain("**Actor:** developer123");
      expect(result.contextualPrompt).toContain("**Issue Title:** Add user authentication feature");
      expect(result.contextualPrompt).toContain("**Comment Author:** developer123");
      expect(result.contextualPrompt).toContain("@pullfrog please create a detailed implementation plan");
      
      expect(result.metadata.eventType).toBe("issue_comment");
      expect(result.metadata.entityNumber).toBe(42);
      expect(result.metadata.isPR).toBe(false);
      expect(result.metadata.hasContext).toBe(true);
    });

    it("should enhance prompt with pull request context", () => {
      const basePrompt = "Review this PR";
      const mockContext = createPullRequestContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**PR:** #15");
      expect(result.contextualPrompt).toContain("**PR Title:** Implement JWT authentication system");
      expect(result.contextualPrompt).toContain("**Base Branch:** main");
      expect(result.contextualPrompt).toContain("**Head Branch:** feature/jwt-auth");
      expect(result.contextualPrompt).toContain("**Labels:** enhancement, auth");
      expect(result.contextualPrompt).toContain("**Assignees:** contributor456");
      expect(result.contextualPrompt).toContain("**Draft:** No");
      expect(result.contextualPrompt).toContain("**Mergeable:** Yes");
      expect(result.contextualPrompt).toContain("This PR implements the JWT authentication system");
      
      expect(result.metadata.entityNumber).toBe(15);
      expect(result.metadata.isPR).toBe(true);
    });

    it("should enhance prompt with issue context", () => {
      const basePrompt = "Investigate this bug";
      const mockContext = createIssueContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**Issue:** #87");
      expect(result.contextualPrompt).toContain("**Issue Title:** Memory leak in authentication middleware");
      expect(result.contextualPrompt).toContain("**Issue State:** open");
      expect(result.contextualPrompt).toContain("**Labels:** bug, critical, memory-leak");
      expect(result.contextualPrompt).toContain("**Assignees:** None");
      expect(result.contextualPrompt).toContain("Memory usage keeps growing over time");
      
      expect(result.metadata.entityNumber).toBe(87);
      expect(result.metadata.isPR).toBe(false);
    });

    it("should enhance prompt with PR review comment context", () => {
      const basePrompt = "Address this review comment";
      const mockContext = createPullRequestReviewCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**PR:** #15");
      expect(result.contextualPrompt).toContain("**Comment Author:** senior-dev");
      expect(result.contextualPrompt).toContain("**File:** src/auth/jwt.ts");
      expect(result.contextualPrompt).toContain("**Line:** 45");
      expect(result.contextualPrompt).toContain("token validation logic looks concerning");
      expect(result.contextualPrompt).toContain("Code Context:");
      expect(result.contextualPrompt).toContain("jwt.verify(token, process.env.JWT_SECRET)");
      
      expect(result.metadata.entityNumber).toBe(15);
      expect(result.metadata.isPR).toBe(true);
    });

    it("should enhance prompt with workflow dispatch context", () => {
      const basePrompt = "Perform code review";
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**Event:** workflow_dispatch");
      expect(result.contextualPrompt).toContain("**Run ID:** 22222");
      expect(result.contextualPrompt).toContain("**Workflow Inputs:**");
      expect(result.contextualPrompt).toContain("- **task:** code-review");
      expect(result.contextualPrompt).toContain("- **target_branch:** feature/jwt-auth");
      expect(result.contextualPrompt).toContain("- **focus_areas:** security,performance,testing");
      expect(result.contextualPrompt).toContain("automation request");
      
      expect(result.metadata.entityNumber).toBeUndefined();
      expect(result.metadata.isPR).toBeUndefined();
    });

    it("should handle empty prompt gracefully", () => {
      const basePrompt = "";
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.originalPrompt).toBe("");
      expect(result.contextualPrompt).toBe("");
      expect(result.metadata.hasContext).toBe(false);
    });

    it("should handle whitespace-only prompt", () => {
      const basePrompt = "   \n  \t  ";
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.originalPrompt).toBe(basePrompt);
      expect(result.contextualPrompt).toBe(basePrompt);
      expect(result.metadata.hasContext).toBe(false);
    });

    it("should handle missing payload data gracefully", () => {
      const basePrompt = "Test prompt";
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          issue: {
            ...createIssueCommentContext().payload.issue,
            title: undefined as any,
            body: null as any,
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**Issue Title:** N/A");
      expect(result.contextualPrompt).toContain("No description provided");
    });
  });

  describe("extractTriggerPrompt", () => {
    it("should extract prompt after trigger phrase in comment", () => {
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBe("please create a detailed implementation plan for the authentication feature. Include security considerations and testing approach.");
    });

    it("should extract prompt after trigger phrase in issue body", () => {
      const mockContext = createIssueContext();
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBe("can you investigate this memory leak and suggest a fix? Please also add monitoring to prevent this in the future.\n\nSteps to reproduce:\n1. Start the server\n2. Make repeated authenticated requests\n3. Monitor memory usage over time\n\nExpected: Stable memory usage\nActual: Memory keeps growing until server crashes");
    });

    it("should extract prompt after trigger phrase in review comment", () => {
      const mockContext = createPullRequestReviewCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBe("this token validation logic looks concerning. Can you review the security implications and suggest improvements?");
    });

    it("should return default prompt when only trigger phrase is present", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "@pullfrog",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBe("Please help with this issue/PR");
    });

    it("should return null when trigger phrase not found", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "This comment has no trigger phrase",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBeNull();
    });

    it("should return null for automation contexts", () => {
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBeNull();
    });

    it("should handle custom trigger phrase", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "@custom-bot please help with this authentication issue",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      // Override trigger phrase
      const contextWithCustomTrigger = {
        ...context,
        inputs: { ...context.inputs, triggerPhrase: "@custom-bot" }
      };
      
      const result = extractTriggerPrompt(contextWithCustomTrigger);
      
      expect(result).toBe("please help with this authentication issue");
    });

    it("should handle missing content gracefully", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: undefined as any,
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBeNull();
    });

    it("should extract multiline prompts correctly", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "@pullfrog can you help with this?\n\nHere are the requirements:\n1. Security analysis\n2. Performance review\n3. Test coverage",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = extractTriggerPrompt(context);
      
      expect(result).toBe("can you help with this?\n\nHere are the requirements:\n1. Security analysis\n2. Performance review\n3. Test coverage");
    });
  });

  describe("Context Enhancement Edge Cases", () => {
    it("should handle missing labels array", () => {
      const basePrompt = "Test prompt";
      const mockContext = createPullRequestContext({
        payload: {
          ...createPullRequestContext().payload,
          pull_request: {
            ...createPullRequestContext().payload.pull_request,
            labels: undefined as any,
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**Labels:** None");
    });

    it("should handle missing assignees array", () => {
      const basePrompt = "Test prompt";
      const mockContext = createIssueContext({
        payload: {
          ...createIssueContext().payload,
          issue: {
            ...createIssueContext().payload.issue,
            assignees: undefined as any,
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).toContain("**Assignees:** None");
    });

    it("should handle workflow dispatch without inputs", () => {
      const basePrompt = "Test prompt";
      const mockContext = createWorkflowDispatchContext({
        payload: {
          ...createWorkflowDispatchContext().payload,
          inputs: undefined as any,
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const result = enhancePromptWithContext(basePrompt, context);
      
      expect(result.contextualPrompt).not.toContain("**Workflow Inputs:**");
      expect(result.contextualPrompt).toContain("**Event:** workflow_dispatch");
    });
  });
});