/**
 * Library entry point for npm package
 * This exports the main function for programmatic usage
 */

export { ClaudeAgent } from "./agents/claude.ts";
export type { Agent, AgentConfig, AgentResult } from "./agents/types.ts";
export {
  type ExecutionInputs,
  type MainParams,
  type MainResult,
  main,
} from "./main.ts";
