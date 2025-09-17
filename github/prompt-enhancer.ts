import type { GitHubContext } from "./context.ts";
import {
  isEntityContext,
  isIssuesEvent,
  isIssueCommentEvent,
  isPullRequestEvent,
  isPullRequestReviewEvent,
  isPullRequestReviewCommentEvent,
  isAutomationContext,
} from "./context.ts";

export interface EnhancedPrompt {
  originalPrompt: string;
  contextualPrompt: string;
  metadata: {
    eventType: string;
    entityNumber?: number;
    isPR?: boolean;
    hasContext: boolean;
  };
}

export function enhancePromptWithContext(
  basePrompt: string,
  context: GitHubContext,
): EnhancedPrompt {
  const metadata = {
    eventType: context.eventName,
    entityNumber: isEntityContext(context) ? context.entityNumber : undefined,
    isPR: isEntityContext(context) ? context.isPR : undefined,
    hasContext: true,
  };

  // If no base prompt provided, don't enhance
  if (!basePrompt.trim()) {
    return {
      originalPrompt: basePrompt,
      contextualPrompt: basePrompt,
      metadata: { ...metadata, hasContext: false },
    };
  }

  let contextualPrompt = basePrompt;

  // Add GitHub context based on event type
  if (isEntityContext(context)) {
    contextualPrompt = enhanceEntityEventPrompt(basePrompt, context);
  } else if (isAutomationContext(context)) {
    contextualPrompt = enhanceAutomationEventPrompt(basePrompt, context);
  }

  return {
    originalPrompt: basePrompt,
    contextualPrompt,
    metadata,
  };
}

function enhanceEntityEventPrompt(
  basePrompt: string,
  context: GitHubContext & { entityNumber: number; isPR: boolean },
): string {
  const repo = context.repository.full_name;
  const entityType = context.isPR ? "PR" : "Issue";
  const entityNumber = context.entityNumber;

  let contextSection = `
## GitHub Context
**Repository:** ${repo}
**Event:** ${context.eventName}
**${entityType}:** #${entityNumber}
**Actor:** ${context.actor}
`;

  // Add event-specific context
  if (isIssuesEvent(context)) {
    const issue = context.payload.issue;
    contextSection += `
**Issue Title:** ${issue?.title || "N/A"}
**Issue State:** ${issue?.state || "N/A"}
**Labels:** ${issue?.labels?.map((l: any) => l.name).join(", ") || "None"}
**Assignees:** ${issue?.assignees?.map((a: any) => a.login).join(", ") || "None"}
**Created:** ${issue?.created_at || "N/A"}

**Issue Body:**
\`\`\`
${issue?.body || "No description provided"}
\`\`\`
`;
  } else if (isIssueCommentEvent(context)) {
    const issue = context.payload.issue;
    const comment = context.payload.comment;
    contextSection += `
**Issue Title:** ${issue?.title || "N/A"}
**Comment Author:** ${comment?.user?.login || "N/A"}
**Comment Created:** ${comment?.created_at || "N/A"}

**Comment Body:**
\`\`\`
${comment?.body || "No comment content"}
\`\`\`

**Issue Body:**
\`\`\`
${issue?.body || "No description provided"}
\`\`\`
`;
  } else if (isPullRequestEvent(context)) {
    const pr = context.payload.pull_request;
    contextSection += `
**PR Title:** ${pr?.title || "N/A"}
**PR State:** ${pr?.state || "N/A"}
**Base Branch:** ${pr?.base?.ref || "N/A"}
**Head Branch:** ${pr?.head?.ref || "N/A"}
**Labels:** ${pr?.labels?.map((l: any) => l.name).join(", ") || "None"}
**Assignees:** ${pr?.assignees?.map((a: any) => a.login).join(", ") || "None"}
**Draft:** ${pr?.draft ? "Yes" : "No"}
**Mergeable:** ${pr?.mergeable !== null ? (pr?.mergeable ? "Yes" : "No") : "Unknown"}

**PR Description:**
\`\`\`
${pr?.body || "No description provided"}
\`\`\`
`;
  } else if (isPullRequestReviewEvent(context)) {
    const pr = context.payload.pull_request;
    const review = context.payload.review;
    contextSection += `
**PR Title:** ${pr?.title || "N/A"}
**Review State:** ${review?.state || "N/A"}
**Reviewer:** ${review?.user?.login || "N/A"}
**Review Submitted:** ${review?.submitted_at || "N/A"}

**Review Body:**
\`\`\`
${review?.body || "No review comment"}
\`\`\`

**PR Description:**
\`\`\`
${pr?.body || "No description provided"}
\`\`\`
`;
  } else if (isPullRequestReviewCommentEvent(context)) {
    const pr = context.payload.pull_request;
    const comment = context.payload.comment;
    contextSection += `
**PR Title:** ${pr?.title || "N/A"}
**Comment Author:** ${comment?.user?.login || "N/A"}
**File:** ${comment?.path || "N/A"}
**Line:** ${comment?.line || comment?.original_line || "N/A"}

**Review Comment:**
\`\`\`
${comment?.body || "No comment content"}
\`\`\`

**Code Context:**
\`\`\`
${comment?.diff_hunk || "No diff available"}
\`\`\`
`;
  }

  return `${basePrompt}

${contextSection}

---

Please analyze the above GitHub context and respond appropriately to the user's request.`;
}

function enhanceAutomationEventPrompt(
  basePrompt: string,
  context: GitHubContext,
): string {
  const repo = context.repository.full_name;

  let contextSection = `
## GitHub Context
**Repository:** ${repo}
**Event:** ${context.eventName}
**Actor:** ${context.actor}
**Run ID:** ${context.runId}
`;

  if (context.eventName === "workflow_dispatch") {
    const payload = context.payload as any;
    if (payload.inputs && Object.keys(payload.inputs).length > 0) {
      contextSection += `
**Workflow Inputs:**
${Object.entries(payload.inputs)
  .map(([key, value]) => `- **${key}:** ${value}`)
  .join("\n")}
`;
    }
  } else if (context.eventName === "schedule") {
    contextSection += `
**Schedule:** Automated cron trigger
`;
  }

  return `${basePrompt}

${contextSection}

---

Please analyze the above GitHub context and respond appropriately to the automation request.`;
}

export function extractTriggerPrompt(context: GitHubContext): string | null {
  if (!isEntityContext(context)) {
    return null;
  }

  const triggerPhrase = context.inputs.triggerPhrase;

  // Extract prompt from comment or issue body
  let content = "";
  
  if (isIssueCommentEvent(context) || isPullRequestReviewCommentEvent(context)) {
    content = (context.payload as any).comment?.body || "";
  } else if (isIssuesEvent(context)) {
    content = (context.payload as any).issue?.body || "";
  }

  // Find the trigger phrase and extract everything after it
  const triggerIndex = content.indexOf(triggerPhrase);
  if (triggerIndex === -1) {
    return null;
  }

  // Extract text after the trigger phrase
  const afterTrigger = content.substring(triggerIndex + triggerPhrase.length).trim();
  
  // If there's content after the trigger, use it as the prompt
  if (afterTrigger) {
    return afterTrigger;
  }

  // If only the trigger phrase, return a default prompt
  return "Please help with this issue/PR";
}