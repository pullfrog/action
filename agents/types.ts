/**
 * Standard interface for all Pullfrog agents
 */
export interface Agent {
  /**
   * Install the agent and any required dependencies
   */
  install(): Promise<void>;

  /**
   * Execute the agent with the given prompt
   * @param prompt The prompt to send to the agent
   * @param options Additional options specific to the agent
   */
  execute(prompt: string, options?: Record<string, any>): Promise<AgentResult>;
}

/**
 * Result returned by agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Configuration for agent creation
 */
export interface AgentConfig {
  apiKey: string;
  githubInstallationToken: string;
}
