/**
 * Library entry point for npm package
 * This exports the main function for programmatic usage
 */

export { ClaudeAgent } from "./agents/claude.ts";
export type { Agent, AgentConfig, AgentResult } from "./agents/types.ts";
export {
  type ActionInputs as ExecutionInputs,
  type MainResult,
  main,
} from "./main.ts";
