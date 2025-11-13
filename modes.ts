import { ghPullfrogMcpName } from "./mcp/config.ts";

export const modes = [
  {
    name: "Plan",
    description:
      "Create plans, break down tasks, outline steps, analyze requirements, understand scope of work, or provide task breakdowns",
    prompt: `Follow these steps:
1. Before beginning, take some time to learn about the codebase. Read the AGENTS.md file if it exists. Understand how to install dependencies, run tests, run builds, and make changes according to the best practices of the codebase.
2. Create initial response comment using ${ghPullfrogMcpName}/create_issue_comment saying "I'll {summary of request}" and save the commentId
3. Analyze the request and break it down into clear, actionable tasks
4. Consider dependencies, potential challenges, and implementation order
5. Create a structured plan with clear milestones
6. Update your comment using ${ghPullfrogMcpName}/edit_issue_comment with the commentId to present the plan in a clear, organized format
7. Continue updating the same comment as needed (never create additional comments - always use edit_issue_comment)`,
  },
  {
    name: "Build",
    description:
      "Implement, build, create, or develop code changes; make specific changes to files or features; execute a plan; or handle tasks with specific implementation details",
    prompt: `Follow these steps:
1. Before beginning, take some time to learn about the codebase. Read the AGENTS.md file if it exists. Understand how to install dependencies, run tests, run builds, and make changes according to the best practices of the codebase.
2. Create initial response comment using ${ghPullfrogMcpName}/create_issue_comment saying "I'll {summary of request}" and save the commentId
3. Understand the requirements and any existing plan
4. Make the necessary code changes
5. Test your changes to ensure they work correctly
6. Update your comment using ${ghPullfrogMcpName}/edit_issue_comment with the commentId to share progress and results
7. Continue updating the same comment as you make progress (never create additional comments - always use edit_issue_comment)`,
  },
  {
    name: "Review",
    description:
      "Review code, PRs, or implementations; provide feedback or suggestions; identify issues; or check code quality, style, and correctness",
    prompt: `Follow these steps:
1. Create initial response comment using ${ghPullfrogMcpName}/create_issue_comment saying "I'll review this" and save the commentId
2. Get PR info with ${ghPullfrogMcpName}/get_pull_request (this automatically prepares the repository by fetching and checking out the PR branch)
3. View diff: git diff origin/<base>...origin/<head> (use line numbers from this for inline comments, replace <base> and <head> with 'base' and 'head' from PR info)
4. Read files from the checked-out PR branch to understand the implementation
5. Update your comment using ${ghPullfrogMcpName}/edit_issue_comment with findings as you review
6. When submitting review: use the 'comments' array for ALL specific code issues - include the file path and line position from the diff
7. Only use the 'body' field for a brief summary (1-2 sentences) or for feedback that doesn't apply to a specific code location
8. Continue updating the same comment as needed (never create additional comments - always use edit_issue_comment)`,
  },
  {
    name: "Prompt",
    description:
      "Fallback for tasks that don't fit other workflows, direct prompts via comments, or requests requiring general assistance without a specific workflow pattern",
    prompt: `Follow these steps:
1. Create an initial "Progress Comment" using ${ghPullfrogMcpName}/create_issue_comment saying "I'll {summary of request}" and save the commentId
2. Perform the requested task. Only take action if you have high confidence that you understand what is being asked. If you are not sure, ask for clarification. Take stock of the tools at your disposal.
3. As your work progresses, update your Progress Comment to share progress and results. Using ${ghPullfrogMcpName}/edit_issue_comment and the commentId you saved earlier. Do not create additional comments unless you are explicitly asked to do so.
4. When you finish the task, update the Progress Comment a final time to confirm completion. If you created any issues, PRs, etc, include appropriate links to it here.`,
  },
] as const;
