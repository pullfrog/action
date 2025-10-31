import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { ghPullfrogMcpName } from "../mcp/config.ts";

/**
 * Result returned by agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for agent creation
 */
export interface AgentConfig {
  apiKey: string;
  githubInstallationToken: string;
  prompt: string;
  mcpServers: Record<string, McpServerConfig>;
}

export type Agent = {
  run: (config: AgentConfig) => Promise<AgentResult>;
};

export const instructions = `- use the ${ghPullfrogMcpName} MCP server to interact with github
- if ${ghPullfrogMcpName} is not available or doesn't include the functionality you need, describe why and bail
- do not under any circumstances use the gh cli
- if prompted by a comment to respond to create a new issue, pr or anything else, after succeeding,
    also respond to the original comment with a very brief message containing a link to it
- if prompted to review a PR:
    (1) get PR info with mcp__${ghPullfrogMcpName}__get_pull_request
    (2) fetch both branches: git fetch origin <base> --depth=20 && git fetch origin <head>
    (3) checkout the PR branch: git checkout origin/<head> (you MUST do this before reading any files)
    (4) view diff: git diff origin/<base>...origin/<head> (this shows what changed)
    (5) read files from the checked-out PR branch to understand the implementation
    replace <base> and <head> with 'base' and 'head' from the PR info
`;
