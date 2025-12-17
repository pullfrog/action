import { ghPullfrogMcpName } from "./external.ts";

export interface Mode {
  name: string;
  description: string;
  prompt: string;
}

export interface GetModesParams {
  disableProgressComment: true | undefined;
  dependenciesPreinstalled: true | undefined;
}

const reportProgressInstruction = `Use ${ghPullfrogMcpName}/report_progress to share progress and results. Continue calling it as you make progress - it will update the same comment. Never create additional comments manually.`;

export function getModes({
  disableProgressComment,
  dependenciesPreinstalled,
}: GetModesParams): Mode[] {
  const depsContext = dependenciesPreinstalled
    ? "Dependencies have already been installed."
    : "understand how to install dependencies,";

  return [
    {
      name: "Build",
      description:
        "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
      prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists, ${depsContext} run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

2. Create a branch using ${ghPullfrogMcpName}/create_branch. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit directly to main, master, or production. Do NOT use git commands directly - always use ${ghPullfrogMcpName} MCP tools for git operations.

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
      prompt: `Follow these steps:
1. Checkout the PR using ${ghPullfrogMcpName}/checkout_pr with the PR number. This fetches the PR branch and configures push settings (including for fork PRs).

2. Review the feedback provided. Understand each review comment and what changes are being requested.
   - **EVENT DATA may contain review comment details**: If available, \`approved_comments\` are comments to address, \`unapproved_comments\` are for context only. The \`triggerer\` field indicates who initiated this action - prioritize their replies when deciding how to implement fixes.
   - You can use ${ghPullfrogMcpName}/get_pull_request to get PR metadata if needed.

3. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists.

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
      prompt: `Follow these steps:
1. Checkout the PR using ${ghPullfrogMcpName}/checkout_pr with the PR number. This fetches the PR branch and base branch, preparing the repo for review.

2. **IMPORTANT**: After calling ${ghPullfrogMcpName}/checkout_pr, the PR branch is checked out locally. View diff using: \`git diff origin/<base>..HEAD\` (replace <base> with 'base' from checkout_pr result, e.g., \`git diff origin/main..HEAD\`). Use two dots (..) not three dots (...) for reliable diffs. Do NOT use \`origin/<head>\` - the branch is checked out locally, not as a remote tracking branch. This works for both same-repo and fork PRs.

3. Start review session using ${ghPullfrogMcpName}/start_review. This creates a scratchpad file at a temp path (e.g., \`/tmp/pullfrog-review-abc123.md\`) and returns a session ID. The scratchpad file header contains the session ID for reference. Use this file as free-form space to gather your thoughts before adding comments.

4. **ANALYZE** - Use the scratchpad to gather your thoughts:
   - Summarize what changes this PR makes
   - Evaluate the approach - is it sound? If not, **stop here** and leave feedback on the approach. Don't waste time on implementation details if the approach is wrong.
   - If approach is sound, analyze implementation - consider potential issues per file
   - Identify bugs, security issues, edge cases

5. **SELF-CRITIQUE** - Before adding comments, review your scratchpad:
   - Remove nitpicks unless explicitly requested. Think documentation, JSDoc/docstrings, useless comments (compliments)
   - Your level of nitpickiness should be proportional to the current state of the codebase. Try to guess how much the user will care about a specific critique.

6. Add inline review comments one-by-one using ${ghPullfrogMcpName}/add_review_comment
   - Use **relative paths** from repo root (e.g., \`packages/core/src/utils.ts\`)
   - Use the NEW file line number from the diff (shown after \`+\` in hunk headers like \`@@ -10,5 +12,8 @@\` means new file starts at line 12)
   - Only comment on lines that appear in the diff. GitHub will reject comments on unchanged lines.
   - For issues appearing in multiple places, comment on the FIRST occurrence and reference others (e.g., "also at lines X, Y")

7. Submit the review using ${ghPullfrogMcpName}/submit_review
   - The "body" field is ONLY for: (1) a 1-3 sentence high-level overview, (2) urgency level (e.g., "minor suggestions" vs "blocking issues"), (3) critical security callouts (e.g., API key exposure)

**GENERAL GUIDANCE**

- Do not leave any comments that are not potentially actionable. Do not leave complimentary comments just to be nice.
- Do not nitpick unless instructed explicitly to do so by the user's additional instructions. This includes: requesting documentation/docstrings/JSDoc.
- **CRITICAL: Prioritize per-line feedback over summary text.**
  - All specific feedback MUST go in inline review comments with file paths and line numbers from the diff
  - The vast majority of review content should be in inline review comments; the body should be brief and only summarize the urgency of the review and any cross-cutting concerns.
  `,
    },
    {
      name: "Plan",
      description:
        "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
      prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context (read AGENTS.md if it exists, ${depsContext} run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

2. Analyze the request and break it down into clear, actionable tasks

3. Consider dependencies, potential challenges, and implementation order

4. Create a structured plan with clear milestones${disableProgressComment ? "" : `\n\n5. ${reportProgressInstruction}`}`,
    },
    {
      name: "Prompt",
      description:
        "Fallback for tasks that don't fit other workflows, e.g. direct prompts via comments, or requests requiring general assistance",
      prompt: `Follow these steps:
1. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.${disableProgressComment ? "" : "\n\n2. When creating comments, always use report_progress. Do not use create_issue_comment."}

2. If the task involves making code changes:
   - Create a branch using ${ghPullfrogMcpName}/create_branch. Branch names should be prefixed with "pullfrog/" and reflect the exact changes you are making. Never commit directly to main, master, or production.
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
  dependenciesPreinstalled: undefined,
});
