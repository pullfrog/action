import { describe, it, expect } from "vitest";
import { detectMode, checkContainsTrigger, getModeDescription, shouldUseTrackingComment, getDefaultPromptForMode } from "../../github/modes.ts";
import { parseGitHubContext } from "../../github/context.ts";
import { createIssueCommentContext, createPullRequestContext, createIssueContext, createWorkflowDispatchContext, createPullRequestReviewCommentContext } from "../utils/mockContext.ts";

describe("Mode Detection", () => {
  describe("detectMode", () => {
    it("should detect agent mode when prompt is provided", () => {
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      // Override inputs to include prompt
      const contextWithPrompt = {
        ...context,
        inputs: { ...context.inputs, prompt: "Analyze this repository" }
      };

      const mode = detectMode(contextWithPrompt);
      expect(mode).toBe("agent");
    });

    it("should detect tag mode for issue comment with trigger phrase", () => {
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const mode = detectMode(context);
      expect(mode).toBe("tag");
    });

    it("should detect tag mode for issue with trigger phrase", () => {
      const mockContext = createIssueContext();
      const context = parseGitHubContext(mockContext);
      
      const mode = detectMode(context);
      expect(mode).toBe("tag");
    });

    it("should detect tag mode for PR review comment with trigger phrase", () => {
      const mockContext = createPullRequestReviewCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const mode = detectMode(context);
      expect(mode).toBe("tag");
    });

    it("should default to agent mode when no trigger phrase found", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "This is a regular comment without trigger phrase",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const mode = detectMode(context);
      expect(mode).toBe("agent");
    });

    it("should prioritize agent mode when both prompt and trigger phrase are present", () => {
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const contextWithPrompt = {
        ...context,
        inputs: { ...context.inputs, prompt: "Explicit prompt overrides trigger" }
      };

      const mode = detectMode(contextWithPrompt);
      expect(mode).toBe("agent");
    });

    it("should default to agent mode for automation events without prompt", () => {
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      const mode = detectMode(context);
      expect(mode).toBe("agent");
    });
  });

  describe("checkContainsTrigger", () => {
    it("should detect trigger phrase in issue comment", () => {
      const mockContext = createIssueCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(true);
    });

    it("should detect trigger phrase in issue body", () => {
      const mockContext = createIssueContext();
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(true);
    });

    it("should detect trigger phrase in PR review comment", () => {
      const mockContext = createPullRequestReviewCommentContext();
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(true);
    });

    it("should not detect trigger phrase when not present", () => {
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
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
    });

    it("should handle custom trigger phrase", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "@custom-bot please help with this issue",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const contextWithCustomTrigger = {
        ...context,
        inputs: { ...context.inputs, triggerPhrase: "@custom-bot" }
      };
      
      const containsTrigger = checkContainsTrigger(contextWithCustomTrigger);
      expect(containsTrigger).toBe(true);
    });

    it("should return false for automation contexts", () => {
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
    });

    it("should handle missing comment body gracefully", () => {
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
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
    });

    it("should handle missing issue body gracefully", () => {
      const mockContext = createIssueContext({
        payload: {
          ...createIssueContext().payload,
          issue: {
            ...createIssueContext().payload.issue,
            body: null as any,
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
    });
  });

  describe("Helper Functions", () => {
    it("should return correct mode descriptions", () => {
      expect(getModeDescription("tag")).toBe("Interactive mode triggered by @pullfrog mentions");
      expect(getModeDescription("agent")).toBe("Direct automation mode for explicit prompts");
      expect(getModeDescription("unknown" as any)).toBe("Unknown mode");
    });

    it("should determine tracking comment usage correctly", () => {
      expect(shouldUseTrackingComment("tag")).toBe(true);
      expect(shouldUseTrackingComment("agent")).toBe(false);
    });

    it("should return correct default prompts for modes", () => {
      const mockContext = createWorkflowDispatchContext();
      const context = parseGitHubContext(mockContext);
      
      const contextWithPrompt = {
        ...context,
        inputs: { ...context.inputs, prompt: "Test prompt" }
      };

      expect(getDefaultPromptForMode("tag", context)).toBeUndefined();
      expect(getDefaultPromptForMode("agent", contextWithPrompt)).toBe("Test prompt");
      expect(getDefaultPromptForMode("unknown" as any, context)).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle PR events correctly (not currently supported for tag mode)", () => {
      const mockContext = createPullRequestContext({
        payload: {
          ...createPullRequestContext().payload,
          pull_request: {
            ...createPullRequestContext().payload.pull_request,
            body: "@pullfrog please review this PR",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      // PR events are not currently handled by checkContainsTrigger
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
      
      const mode = detectMode(context);
      expect(mode).toBe("agent");
    });

    it("should be case sensitive for trigger phrase detection", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "@PULLFROG please help", // Different case
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(false);
    });

    it("should detect trigger phrase anywhere in the content", () => {
      const mockContext = createIssueCommentContext({
        payload: {
          ...createIssueCommentContext().payload,
          comment: {
            ...createIssueCommentContext().payload.comment,
            body: "Hey team, I think @pullfrog could help us with this authentication issue. What do you think?",
          },
        },
      });
      const context = parseGitHubContext(mockContext);
      
      const containsTrigger = checkContainsTrigger(context);
      expect(containsTrigger).toBe(true);
    });
  });
});