import { ClaudeAgent } from "./claude";
import type { Agent, AgentConfig } from "./types";

export type AgentType = "claude";

/**
 * Factory for creating agent instances
 */
export function createAgent(type: AgentType, config: AgentConfig): Agent {
  switch (type) {
    case "claude":
      return new ClaudeAgent(config);
    default:
      throw new Error(`Unsupported agent type: ${type}`);
  }
}
