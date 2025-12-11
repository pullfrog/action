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

export function getModes({ disableProgressComment }: GetModesParams): Mode[] {
  return [
    {
      name: "Build",
      description:
        "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
      prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

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
1. Get PR info with ${ghPullfrogMcpName}/get_pull_request (this automatically fetches and checks out the PR branch)

2. Review the feedback provided. Understand each review comment and what changes are being requested.

3. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists.

4. Make the necessary code changes to address the feedback. Work through each review comment systematically.

5. **CRITICAL: Reply to EACH review comment individually.** After fixing each comment, use ${ghPullfrogMcpName}/reply_to_review_comment to reply directly to that comment thread. Keep replies extremely brief (1 sentence max, e.g., "Fixed by renaming to X" or "Added null check").

6. Test your changes to ensure they work correctly.

7. When done, commit and push your changes to the existing PR branch. Do not create a new branch or PR - you are updating an existing one.
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
1. Get PR info with ${ghPullfrogMcpName}/get_pull_request (this automatically prepares the repository by fetching and checking out the PR branch)

2. View diff: git diff origin/<base>...origin/<head> (use line numbers from this for inline comments, replace <base> and <head> with 'base' and 'head' from PR info)

3. Read files from the checked-out PR branch to understand the implementation

4. Submit review using ${ghPullfrogMcpName}/submit_pull_request_review

**CRITICAL: Prioritize per-line feedback over summary text.**
- ALL specific feedback MUST go in the 'comments' array with file paths and line numbers from the diff
- for issues appearing in multiple places, comment on the FIRST occurrence and reference others (e.g., "also at lines X, Y" or "similar issue in otherFile.ts:42")
- the 'body' field is ONLY for: (1) a 1-2 sentence high-level overview, (2) urgency level (e.g., "minor suggestions" vs "blocking issues"), (3) critical security callouts (e.g., API key exposure)
- 95%+ of review content should be in per-line comments; the body should be just a couple sentences
- the review body will include quick action links for addressing feedback, so keep it concise`,
    },
    {
      name: "Plan",
      description:
        "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
      prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context (read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

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

export const modes: Mode[] = getModes({ disableProgressComment: undefined });
