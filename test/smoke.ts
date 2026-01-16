import type { AgentResult, ValidationCheck } from "./utils.ts";
import { runTests } from "./utils.ts";

/**
 * smoke test - validates agent can connect to API and call MCP tools.
 * verifies select_mode tool is called with correct params.
 */

function validator(result: AgentResult): ValidationCheck[] {
  // verify MCP tool was called with correct params:
  // → select_mode({"modeName":"Build"}) or → mcp__gh_pullfrog__select_mode({"modeName":"Build"})
  const toolCallValid = /→.*select_mode\s*\([^)]*"modeName"\s*:\s*"Build"/i.test(result.output);
  // verify agent confirmed success
  const confirmationFound = /SMOKE TEST PASSED/i.test(result.output);

  return [
    { name: "tool_call", passed: toolCallValid },
    { name: "confirm", passed: confirmationFound },
  ];
}

runTests({
  name: "smoke tests",
  fixture: "smoke.ts",
  validator,
});
