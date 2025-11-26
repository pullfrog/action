import { ghPullfrogMcpName } from "./external.ts";

export interface Mode {
  name: string;
  description: string;
  prompt: string;
}

const initialCommentInstruction = `When the task is associated with an issue/PR, use ${ghPullfrogMcpName}/create_working_comment to create an initial Working Comment with a conversational description of what work you are about to perform.`;

export const modes: Mode[] = [
  {
    name: "Build",
    description:
      "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
    prompt: `Follow these steps:
1. ${initialCommentInstruction}

2. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

3. Create a branch for your work. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit to directly to main, master, or production.

4. Understand the requirements and any existing plan

5. Make the necessary code changes. Create intermediate commits if called for.

6. Test your changes to ensure they work correctly

7. Update your comment using ${ghPullfrogMcpName}/update_working_comment to share progress and results.

8. Continue updating the same comment as you make progress. Never create additional comments. Always use update_working_comment.

9. When you are done, create a final commit. If relevant, indicate which issue the PR addresses somewhere in the commit message (e.g. "Fixes #123"). Create a PR with an informative title and body. If relevant, include links to the issue or comment that triggered the PR.

10. Update the Working Comment one final time with a summary of the results. Include links to any created issues/PRs, e.g. \`[View PR](https://github.com/org/repo/pull/123)\`
`,
  },
  {
    name: "Review",
    description:
      "Review code, PRs, or implementations; provide feedback or suggestions; identify issues; or check code quality, style, and correctness",
    prompt: `Follow these steps:
1. ${initialCommentInstruction}

2. Get PR info with ${ghPullfrogMcpName}/get_pull_request (this automatically prepares the repository by fetching and checking out the PR branch)

3. View diff: git diff origin/<base>...origin/<head> (use line numbers from this for inline comments, replace <base> and <head> with 'base' and 'head' from PR info)

4. Read files from the checked-out PR branch to understand the implementation

5. Update your comment using ${ghPullfrogMcpName}/update_working_comment with findings as you review

6. When submitting review: use the 'comments' array for ALL specific code issues - include the file path and line position from the diff

7. Only use the 'body' field for a brief summary (1-2 sentences) or for feedback that doesn't apply to a specific code location

8. Continue updating the same comment as needed (never create additional comments - always use update_working_comment)`,
  },
  {
    name: "Plan",
    description:
      "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
    prompt: `Follow these steps:
1. ${initialCommentInstruction}

2. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context (read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

3. Analyze the request and break it down into clear, actionable tasks

4. Consider dependencies, potential challenges, and implementation order

5. Create a structured plan with clear milestones

6. Update your comment using ${ghPullfrogMcpName}/update_working_comment to present the plan in a clear, organized format

7. Continue updating the same comment as needed (never create additional comments - always use update_working_comment)`,
  },
  {
    name: "Prompt",
    description:
      "Fallback for tasks that don't fit other workflows, direct prompts via comments, or requests requiring general assistance without a specific workflow pattern",
    prompt: `Follow these steps:
1. ${initialCommentInstruction}

2. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.

3. If the task involves making code changes:
   - Create a branch for your work. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit to directly to main, master, or production.
   - Make the necessary code changes. Create intermediate commits if called for.
   - Test your changes to ensure they work correctly.
   - When you are done, create a final commit. If relevant, indicate which issue the PR addresses somewhere in the commit message (e.g. "Fixes #123"). Create a PR with an informative title and body. If relevant, include links to the issue or comment that triggered the PR.

4. As your work progresses, update your Working Comment to share progress and results using ${ghPullfrogMcpName}/update_working_comment. Do not create additional comments unless you are explicitly asked to do so.

5. When you finish the task, update the Working Comment a final time with a summary of the results and links to any created issues, PRs, etc.`,
  },
];
