import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

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
