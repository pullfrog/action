import { ghPullfrogMcpName } from "./external.ts";

export interface Mode {
  name: string;
  description: string;
  prompt: string;
}

const reportProgressInstruction = `Use ${ghPullfrogMcpName}/report_progress to share progress and results. Continue calling it as you make progress - it will update the same comment. Never create additional comments manually.`;

export const modes: Mode[] = [
  {
    name: "Build",
    description:
      "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
    prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context. Read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

2. Create a branch for your work. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit to directly to main, master, or production.

3. Understand the requirements and any existing plan

4. Make the necessary code changes. Create intermediate commits if called for.

5. Test your changes to ensure they work correctly

6. ${reportProgressInstruction}

7. When you are done, create a final commit. If relevant, indicate which issue the PR addresses somewhere in the commit message (e.g. "Fixes #123"). Create a PR with an informative title and body. If relevant, include links to the issue or comment that triggered the PR.

8. Call report_progress one final time with a summary of the results. Include links to any created issues/PRs, e.g. \`[View PR](https://github.com/org/repo/pull/123)\`
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

5. After addressing each review comment, use ${ghPullfrogMcpName}/reply_to_review_comment to reply directly to that comment thread explaining what change was made (keep replies concise, 1-2 sentences).

6. Test your changes to ensure they work correctly.

7. ${reportProgressInstruction}

8. When done, commit and push your changes to the existing PR branch. Do not create a new branch or PR - you are updating an existing one.

9. Call report_progress one final time with a summary of all changes made.
`,
  },
  {
    name: "Review",
    description:
      "Review code, PRs, or implementations; provide feedback or suggestions; identify issues; or check code quality, style, and correctness",
    prompt: `Follow these steps:
1. Get PR info with ${ghPullfrogMcpName}/get_pull_request (this automatically prepares the repository by fetching and checking out the PR branch)

2. View diff: git diff origin/<base>...origin/<head> (use line numbers from this for inline comments, replace <base> and <head> with 'base' and 'head' from PR info)

3. Read files from the checked-out PR branch to understand the implementation

4. ${reportProgressInstruction}

5. When submitting review: use the 'comments' array for ALL specific code issues - include the file path and line position from the diff

6. Only use the 'body' field for a brief summary (1-2 sentences) or for feedback that doesn't apply to a specific code location`,
  },
  {
    name: "Plan",
    description:
      "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
    prompt: `Follow these steps:
1. If the request requires understanding the codebase structure, dependencies, or conventions, gather relevant context (read AGENTS.md if it exists, understand how to install dependencies, run tests, run builds, and make changes according to best practices). Skip this step if the prompt is trivial and self-contained.

2. Analyze the request and break it down into clear, actionable tasks

3. Consider dependencies, potential challenges, and implementation order

4. Create a structured plan with clear milestones

5. ${reportProgressInstruction}`,
  },
  {
    name: "Prompt",
    description:
      "Fallback for tasks that don't fit other workflows, e.g. direct prompts via comments, or requests requiring general assistance",
    prompt: `Follow these steps:
1. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.

2. When creating comments, always use report_progress. Do not use create_issue_comment.

2. If the task involves making code changes:
   - Create a branch for your work. The branch name should be prefixed with "pullfrog/". The rest of the name should reflect the exact changes you are making. It should be specific to avoid collisions with other branches. Never commit to directly to main, master, or production.
   - Make the necessary code changes. Create intermediate commits if called for.
   - Test your changes to ensure they work correctly.
   - When you are done, create a final commit. If relevant, indicate which issue the PR addresses somewhere in the commit message (e.g. "Fixes #123"). Create a PR with an informative title and body. If relevant, include links to the issue or comment that triggered the PR.

3. ${reportProgressInstruction}

4. When finished with the task, use report_progress one final time to update the comment with a summary of the results and links to any created issues, PRs, etc.`,
  },
];
