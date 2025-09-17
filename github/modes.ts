import type { GitHubContext } from "./context.ts";
import {
  isEntityContext,
  isIssueCommentEvent,
  isPullRequestReviewCommentEvent,
  isIssuesEvent,
} from "./context.ts";

export type AutoDetectedMode = "tag" | "agent";

export function detectMode(context: GitHubContext): AutoDetectedMode {
  // If prompt is provided, use agent mode for direct execution
  if (context.inputs?.prompt) {
    return "agent";
  }

  // Check for @pullfrog mentions (tag mode) in entity events
  if (isEntityContext(context)) {
    if (
      isIssueCommentEvent(context) ||
      isPullRequestReviewCommentEvent(context)
    ) {
      if (checkContainsTrigger(context)) {
        return "tag";
      }
    }

    if (isIssuesEvent(context)) {
      if (checkContainsTrigger(context)) {
        return "tag";
      }
    }
  }

  // Default to agent mode (which won't trigger without a prompt)
  return "agent";
}

export function checkContainsTrigger(context: GitHubContext): boolean {
  if (!isEntityContext(context)) {
    return false;
  }

  const triggerPhrase = context.inputs.triggerPhrase;
  
  // Check comment content for trigger phrase
  if (isIssueCommentEvent(context) || isPullRequestReviewCommentEvent(context)) {
    const comment = (context.payload as any).comment;
    return comment?.body?.includes(triggerPhrase) || false;
  }

  // Check issue body for trigger phrase
  if (isIssuesEvent(context)) {
    const issue = (context.payload as any).issue;
    return issue?.body?.includes(triggerPhrase) || false;
  }

  return false;
}

export function getModeDescription(mode: AutoDetectedMode): string {
  switch (mode) {
    case "tag":
      return "Interactive mode triggered by @pullfrog mentions";
    case "agent":
      return "Direct automation mode for explicit prompts";
    default:
      return "Unknown mode";
  }
}

export function shouldUseTrackingComment(mode: AutoDetectedMode): boolean {
  return mode === "tag";
}

export function getDefaultPromptForMode(
  mode: AutoDetectedMode,
  context: GitHubContext,
): string | undefined {
  switch (mode) {
    case "tag":
      return undefined;
    case "agent":
      return context.inputs?.prompt;
    default:
      return undefined;
  }
}