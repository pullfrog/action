/**
 * Library entry point for npm package
 * This exports the main function for programmatic usage
 */

export { ClaudeAgent } from "./agents";
export type { Agent, AgentConfig, AgentResult } from "./agents/types";
export {
  type ExecutionInputs,
  type MainParams,
  type MainResult,
  main,
} from "./main";
