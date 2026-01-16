import { type } from "arktype";
import { ghPullfrogMcpName } from "./external.ts";

export interface Mode {
  name: string;
  description: string;
  prompt: string;
}

// arktype schema for Mode validation
export const ModeSchema = type({
  name: "string",
  description: "string",
  prompt: "string",
});

export interface ComputeModesParams {
  disableProgressComment: boolean;
}

const reportProgressInstruction = `Use ${ghPullfrogMcpName}/report_progress to share progress and results. Continue calling it as you make progress - it will update the same comment. Never create additional comments manually.`;

const dependencyInstallationStep = `If this task will require running tests, builds, linters, or CLI commands that need installed packages, call \`${ghPullfrogMcpName}/start_dependency_installation\` NOW. This is non-blocking and allows dependencies to install in the background while you continue. Later, call \`${ghPullfrogMcpName}/await_dependency_installation\` before running commands that need them. Skip this step if only reading code or answering questions.`;

export function computeModes(ctx: ComputeModesParams): Mode[] {
  const disableProgressComment = ctx.disableProgressComment;
  return [
    {
      name: "Build",
      description:
        "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
      prompt: `Follow these steps. THINK HARDER.
1. Determine whether to work on the current branch or create a new one:
   - **PR event, modifying the existing PR**: The PR branch is probably already checked out. Continue on this branch.
   - **PR event, but user wants a NEW branch/PR**: Use \`${ghPullfrogMcpName}/create_branch\` to create a new branch from the current HEAD.
   - As needed use \`${ghPullfrogMcpName}/create_branch\` to create new branches. Always check your current branch status first.
   
   Branch names must be prefixed with "pullfrog/" and be specific enough to avoid collisions. Never commit directly to main/master/production. Do NOT use git commands directly (\`git branch\`, \`git status\`, \`git log\`, etc.) - always use ${ghPullfrogMcpName} MCP tools.

2. ${dependencyInstallationStep}

3. If the request requires understanding the codebase structure or conventions, gather relevant context. Read AGENTS.md if it exists. Skip this step if the prompt is trivial and self-contained.

4. Understand the requirements and any existing plan

5. Make the necessary code changes using file operations. Then use ${ghPullfrogMcpName}/commit_files to commit your changes, and ${ghPullfrogMcpName}/push_branch to push the branch. Do NOT use git commands like \`git commit\` or \`git push\` directly.

6. Test your changes to ensure they work correctly

7. ${reportProgressInstruction}

8. When you are done, use ${ghPullfrogMcpName}/create_pull_request to create a PR. If relevant, indicate which issue the PR addresses in the PR body (e.g. "Fixes #123").

9. By default, create a PR with an informative title and body. However, if the user explicitly requests a branch without a PR (e.g. "implement X in a new branch", "don't create a PR", "branch only"), you still need to use ${ghPullfrogMcpName}/create_pull_request to ensure commits are properly attributed - you can note in the PR description that it's branch-only if needed. 

10. Call report_progress one final time ONLY if you haven't already included all the important information (PR links, branch links, summary) in a previous report_progress call. If you already called report_progress with complete information including PR links after creating the PR, you do NOT need to call it again. Only make a final call if you need to add missing information. When making the final call, ensure it includes:
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
      name: "AddressReviews",
      description:
        "Address PR review feedback; respond to reviewer comments; make requested changes to an existing PR",
      prompt: `Follow these steps. THINK HARDER.
1. Checkout the PR using ${ghPullfrogMcpName}/checkout_pr with the PR number. This fetches the PR branch and configures push settings (including for fork PRs).

2. ${dependencyInstallationStep}

3. Review the feedback provided. Understand each review comment and what changes are being requested.
   - **EVENT DATA may contain review comment details**: If available, \`approved_comments\` are comments to address, \`unapproved_comments\` are for context only. The \`triggerer\` field indicates who initiated this action - prioritize their replies when deciding how to implement fixes.
   - You can use ${ghPullfrogMcpName}/get_pull_request to get PR metadata if needed.

4. If the request requires understanding the codebase structure or conventions, gather relevant context. Read AGENTS.md if it exists.

5. Make the necessary code changes to address the feedback. Work through each review comment systematically.

6. **CRITICAL: Reply to EACH review comment individually.** After fixing each comment, use ${ghPullfrogMcpName}/reply_to_review_comment to reply directly to that comment thread. Keep replies extremely brief (1 sentence max, e.g., "Fixed by renaming to X" or "Added null check"). If suggesting a small, specific, self-contained code change, use GitHub's suggestion format with \`\`\`suggestion blocks.

7. Test your changes to ensure they work correctly.

8. When done, commit your changes with ${ghPullfrogMcpName}/commit_files, then push with ${ghPullfrogMcpName}/push_branch. The push will automatically go to the correct remote (including fork repos). Do not create a new branch or PR - you are updating an existing one.
${
  disableProgressComment
    ? ""
    : `
9. ${reportProgressInstruction}

**CRITICAL: Keep the progress comment extremely brief.** The summary should be 1-2 sentences max (e.g., "Fixed 3 review comments and pushed changes."). Almost all detail belongs in the individual reply_to_review_comment calls, NOT in the progress comment.`
}`,
    },
    {
      name: "Review",
      description:
        "Review code, PRs, or implementations; provide feedback or suggestions; identify issues; or check code quality, style, and correctness",
      prompt: `Follow these steps to review the PR. Think hard. Do not nitpick.

1. **CHECKOUT** - Call ${ghPullfrogMcpName}/checkout_pr with the PR number. This should give you all PR metadata you need, including a \`diffPath\`: a path to a temp file containing the PR diff.


2. **ANALYZE** 
   - Read the modified files to understand the changes in context. Make sure you understand what's being changed.
   - Is it a good idea? Think about the tradeoffs.
   - Is the approach sound? If not, focus on the approach first. Don't waste time on implementation details if the approach is wrong.
   - Can you imagine a better approach? If so, explain. Make sure it's strictly better, not just different.
   - Are there bugs, edge cases, security issues, or usability issues? Use your imagination.

3. **DRAFT** - For each inline comment, find the line in the diff. Each code line shows: \`| OLD | NEW | TYPE | CODE\`. Use the NEW line number (second column). When suggesting specific code changes, use GitHub's suggestion format with \`\`\`suggestion blocks to enable one-click apply. Example:
   you could simplify this
   \`\`\`suggestion
   const result = data.map(x => x.value);
   \`\`\`
   or you could use reduce instead
   \`\`\`suggestion
   const result = data.reduce((acc, x) => [...acc, x.value], []);
   \`\`\`

4. **FILTER COMMENTS** - Do not nitpick! Do not leave compliments that are not actionable. Do not critique the code hygiene or anything stylistic.

5. **SUBMIT** — Use ${ghPullfrogMcpName}/create_pull_request_review with:
- \`comments\`: Array of all inline comments with file paths and line numbers
- \`body\`: Everything else. Aim for a 1-3 sentence summary of the urgency level (e.g., "minor suggestions" vs "blocking issues") and any critical callouts (e.g., API key exposure). It can be longer if there are concerns that do not lend themselves to inline comments.
- If you have no substantive feedback, submit an empty comments array with a brief approving body.
- Again, do not nitpick.

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
1. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.${disableProgressComment ? "" : " When creating comments, always use report_progress. Do not use create_issue_comment."}

2. If the task involves making code changes:
   - Create a branch using ${ghPullfrogMcpName}/create_branch. Branch names should be prefixed with "pullfrog/" and reflect the exact changes you are making. Never commit directly to main, master, or production.
   - ${dependencyInstallationStep}
   - Use file operations to create/modify files with your changes.
   - Use ${ghPullfrogMcpName}/commit_files to commit your changes, then ${ghPullfrogMcpName}/push_branch to push the branch. Do NOT use git commands directly (\`git commit\`, \`git push\`, \`git checkout\`, \`git branch\`) as these will use incorrect credentials.
   - Test your changes to ensure they work correctly.
   - When you are done, use ${ghPullfrogMcpName}/create_pull_request to create a PR. If relevant, indicate which issue the PR addresses in the PR body (e.g. "Fixes #123"). Include links to the issue or comment that triggered the PR in the PR body.

3. ${reportProgressInstruction}

4. When finished with the task, use report_progress one final time ONLY if you haven't already included all the important information (summary, links to PRs/issues) in a previous report_progress call. If you already called report_progress with complete information including links after creating artifacts, you do NOT need to call it again. **IMPORTANT**: Do NOT overwrite a good comment with links/details with a generic message like "I have completed the task."`,
    },
  ];
}

export const modes: Mode[] = computeModes({
  disableProgressComment: false,
});
