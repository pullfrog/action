import { ghPullfrogMcpName } from "./external.ts";

export interface Mode {
  name: string;
  description: string;
  prompt: string;
}

export interface GetModesParams {
  disableProgressComment: true | undefined;
}

const reportProgressInstruction = `Use ${ghPullfrogMcpName}/report_progress to share progress and results. Continue calling it as you make progress - it will update the same comment. Never create additional comments manually.`;

const dependencyInstallationGuidance = `## Dependency Installation

**IMPORTANT**: Immediately after the working branch is checked out, evaluate whether dependencies will be needed at any point during this task:
- Making code changes that will require testing? → Call \`${ghPullfrogMcpName}/start_dependency_installation\` NOW
- Running builds, linters, or CLI commands that require installed packages? → Call \`${ghPullfrogMcpName}/start_dependency_installation\` NOW
- Only reading code or answering questions? → Skip dependency installation

Calling \`start_dependency_installation\` early allows dependencies to install in the background while you explore the codebase and make changes. This is a non-blocking call.

When you need to run tests, builds, or other commands that require dependencies, call \`${ghPullfrogMcpName}/await_dependency_installation\` to ensure they're ready. This will block until installation completes (or auto-start if you forgot to call start earlier).`;

export function getModes({ disableProgressComment }: GetModesParams): Mode[] {
  return [
    {
      name: "Build",
      description:
        "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
      prompt: `Follow these steps. THINK HARDER.
1. If this is a PR event, the PR branch is already checked out - skip branch creation. Otherwise, create a branch using ${ghPullfrogMcpName}/create_branch. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit directly to main, master, or production. Do NOT use git commands directly (including \`git branch\`, \`git status\`, \`git log\`) - always use ${ghPullfrogMcpName} MCP tools for git operations.

${dependencyInstallationGuidance}

2. If the request requires understanding the codebase structure or conventions, gather relevant context. Read AGENTS.md if it exists. Skip this step if the prompt is trivial and self-contained.

3. Understand the requirements and any existing plan

4. Make the necessary code changes using file operations. Then use ${ghPullfrogMcpName}/commit_files to commit your changes, and ${ghPullfrogMcpName}/push_branch to push the branch. Do NOT use git commands like \`git commit\` or \`git push\` directly.

5. Test your changes to ensure they work correctly

6. ${reportProgressInstruction}

7. When you are done, use ${ghPullfrogMcpName}/create_pull_request to create a PR. If relevant, indicate which issue the PR addresses in the PR body (e.g. "Fixes #123").

8. By default, create a PR with an informative title and body. However, if the user explicitly requests a branch without a PR (e.g. "implement X in a new branch", "don't create a PR", "branch only"), you still need to use ${ghPullfrogMcpName}/create_pull_request to ensure commits are properly attributed - you can note in the PR description that it's branch-only if needed. 

9. Call report_progress one final time ONLY if you haven't already included all the important information (PR links, branch links, summary) in a previous report_progress call. If you already called report_progress with complete information including PR links after creating the PR, you do NOT need to call it again. Only make a final call if you need to add missing information. When making the final call, ensure it includes:
  - A summary of what was accomplished
  - Links to any artifacts created (PRs, branches, issues)
  - If you created a PR, ALWAYS include the PR link. e.g.: 
    \`\`\`md
    [View PR ➔](https://github.com/org/repo/pull/123)
    \`\`\`
  - If you created a branch without a PR, ALWAYS include a "Create PR" link and a link to the branch. e.g.:
    
    \`\`\`md
    [\`pullfrog/branch-name\`](https://github.com/pullfrog/scratch/tree/pullfrog/branch-name) • [Create PR ➔](https://github.com/pullfrog/scratch/compare/main...pullfrog/branch-name?quick_pull=1&title=<informative_title>&body=<informative_body>)
    \`\`\`
  
  **IMPORTANT**: Do NOT overwrite a good comment with links/details with a generic message like "I have completed the task. Please review the PR." If your previous report_progress call already contains all the necessary information and links, skip the final call entirely.
`,
    },
    {
      name: "Address Reviews",
      description:
        "Address PR review feedback; respond to reviewer comments; make requested changes to an existing PR",
      prompt: `Follow these steps. THINK HARDER.
1. Checkout the PR using ${ghPullfrogMcpName}/checkout_pr with the PR number. This fetches the PR branch and configures push settings (including for fork PRs).

${dependencyInstallationGuidance}

2. Review the feedback provided. Understand each review comment and what changes are being requested.
   - **EVENT DATA may contain review comment details**: If available, \`approved_comments\` are comments to address, \`unapproved_comments\` are for context only. The \`triggerer\` field indicates who initiated this action - prioritize their replies when deciding how to implement fixes.
   - You can use ${ghPullfrogMcpName}/get_pull_request to get PR metadata if needed.

3. If the request requires understanding the codebase structure or conventions, gather relevant context. Read AGENTS.md if it exists.

4. Make the necessary code changes to address the feedback. Work through each review comment systematically.

5. **CRITICAL: Reply to EACH review comment individually.** After fixing each comment, use ${ghPullfrogMcpName}/reply_to_review_comment to reply directly to that comment thread. Keep replies extremely brief (1 sentence max, e.g., "Fixed by renaming to X" or "Added null check").

6. Test your changes to ensure they work correctly.

7. When done, commit your changes with ${ghPullfrogMcpName}/commit_files, then push with ${ghPullfrogMcpName}/push_branch. The push will automatically go to the correct remote (including fork repos). Do not create a new branch or PR - you are updating an existing one.
${
  disableProgressComment
    ? ""
    : `
8. ${reportProgressInstruction}

**CRITICAL: Keep the progress comment extremely brief.** The summary should be 1-2 sentences max (e.g., "Fixed 3 review comments and pushed changes."). Almost all detail belongs in the individual reply_to_review_comment calls, NOT in the progress comment.`
}`,
    },
    {
      name: "Review",
      description:
        "Review code, PRs, or implementations; provide feedback or suggestions; identify issues; or check code quality, style, and correctness",
      prompt: `Follow these steps. THINK HARDER.

1. **CHECKOUT** - Call ${ghPullfrogMcpName}/checkout_pr with the PR number. This returns all PR metadata you need (title, base, head, fork status, url) - do not call get_pull_request separately. It also returns a \`diffPath\` - read this file to see the diff.

2. **UNDERSTAND CONTEXT** - Read the modified files to understand the changes in context. Don't just look at the diff - understand how the changes affect the overall codebase.

3. **ANALYZE** 
   - What does this PR change? Summarize in 1-2 sentences.
   - Is the approach sound? If not, focus on the approach first. Don't waste time on implementation details if the approach is wrong.
   - What bugs, edge cases, or security issues exist?
   - Could this be made more elegant?

4. **DRAFT** - For each inline comment, find the line in the diff. Each code line shows: \`| OLD | NEW | TYPE | CODE\`. Use the NEW line number (second column).

5. **SELF-CRITIQUE** - Before submitting, review your draft:
   - DO NOT NITPICK. Do not comment on minor formatting changes, changes to playground/scratch files, lack of docs/docsstrings, or small changes that seem irrelevant. Assume these things are intentional by the PR author.
   - DO NOT LEAVE USELESS OR NON-ACTIONABLE COMMENTS. Compliments are not actionable.
   - If you have approach-level concerns, consider whether implementation-level comments are worth including
   - For issues appearing in multiple places, keep only the FIRST occurrence and reference others (e.g., "also at lines X, Y")

6. **SUBMIT** - Use ${ghPullfrogMcpName}/create_pull_request_review with:
- \`comments\`: Array of all inline comments with file paths and line numbers
- \`body\`: Everything else. Aim for a 1-3 sentence summary of the urgency level (e.g., "minor suggestions" vs "blocking issues") and any critical callouts (e.g., API key exposure). It can be longer if there are concerns that do not lend themselves to inline comments.
   

**CRITICAL RULES**
- ALL feedback goes in the ONE create_pull_request_review call. Do not create separate comments.
- Inline \`comments\` can only be placed on lines within diff hunks. For feedback about code outside the diff (e.g., "function X has the same issue"), include it in the \`body\`.
- Cross-cutting concerns that don't fit on a specific line go in the \`body\`, not in a separate comment.
- 95%+ of review content should be in inline \`comments\` array, not the \`body\`
- Do not leave complimentary comments just to be nice
- Do not leave comments that are not actionable
`,
    },
    {
      name: "Plan",
      description:
        "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
      prompt: `Follow these steps. THINK HARDER.
1. If the request requires understanding the codebase structure or conventions, gather relevant context (read AGENTS.md if it exists). Skip this step if the prompt is trivial and self-contained.

2. Analyze the request and break it down into clear, actionable tasks

3. Consider dependencies, potential challenges, and implementation order

4. Create a structured plan with clear milestones${disableProgressComment ? "" : `\n\n5. ${reportProgressInstruction}`}`,
    },
    {
      name: "Prompt",
      description:
        "Fallback for tasks that don't fit other workflows, e.g. direct prompts via comments, or requests requiring general assistance",
      prompt: `Follow these steps. THINK HARDER.
1. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.${disableProgressComment ? "" : "\n\n2. When creating comments, always use report_progress. Do not use create_issue_comment."}

2. If the task involves making code changes:
   - Create a branch using ${ghPullfrogMcpName}/create_branch. Branch names should be prefixed with "pullfrog/" and reflect the exact changes you are making. Never commit directly to main, master, or production.

${dependencyInstallationGuidance}

   - Use file operations to create/modify files with your changes.
   - Use ${ghPullfrogMcpName}/commit_files to commit your changes, then ${ghPullfrogMcpName}/push_branch to push the branch. Do NOT use git commands directly (\`git commit\`, \`git push\`, \`git checkout\`, \`git branch\`) as these will use incorrect credentials.
   - Test your changes to ensure they work correctly.
   - When you are done, use ${ghPullfrogMcpName}/create_pull_request to create a PR. If relevant, indicate which issue the PR addresses in the PR body (e.g. "Fixes #123"). Include links to the issue or comment that triggered the PR in the PR body.

3. ${reportProgressInstruction}

4. When finished with the task, use report_progress one final time ONLY if you haven't already included all the important information (summary, links to PRs/issues) in a previous report_progress call. If you already called report_progress with complete information including links after creating artifacts, you do NOT need to call it again. **IMPORTANT**: Do NOT overwrite a good comment with links/details with a generic message like "I have completed the task."`,
    },
  ];
}

export const modes: Mode[] = getModes({
  disableProgressComment: undefined,
});
