import type { MainParams } from "../main.ts";

// Agent mode fixture - direct automation with explicit prompt
const agentModeParams = {
  inputs: {
    prompt: "Analyze the codebase for security vulnerabilities, particularly in authentication and authorization logic. Create a detailed security audit report with recommendations for improvements.",
    anthropic_api_key: "sk-test-key",
    github_token: "ghp_test_token",
  },
  env: {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ACTOR: "security-team",
    GITHUB_REPOSITORY: "acme/my-project",
    GITHUB_REPOSITORY_OWNER: "acme",
    GITHUB_RUN_ID: "44444",
    INPUT_PROMPT: "Analyze the codebase for security vulnerabilities, particularly in authentication and authorization logic. Create a detailed security audit report with recommendations for improvements.",
  },
  cwd: process.cwd(),
} satisfies MainParams;

export default agentModeParams;