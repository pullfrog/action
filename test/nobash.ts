import type { AgentResult, ValidationCheck } from "./utils.ts";
import { runTests } from "./utils.ts";

/**
 * nobash test - validates agents respect bash=disabled setting.
 * no bash should be available (neither native nor MCP bash).
 */

function validator(result: AgentResult): ValidationCheck[] {
  // verify select_mode MCP tool was called (proves MCP tools work)
  const selectModeCalled = /→.*select_mode\s*\([^)]*"modeName"\s*:\s*"Build"/i.test(result.output);

  // agent should report no bash is available (look for the phrase as standalone output)
  const noBashAvailable = /NO BASH AVAILABLE/i.test(result.output);

  // bash tool should NOT have been called (no → bash or → mcp__gh_pullfrog__bash)
  const bashNotCalled = !/→\s*(?:bash|mcp__gh_pullfrog__bash)\s*\(/i.test(result.output);

  return [
    { name: "mcp_tool", passed: selectModeCalled },
    { name: "no_bash", passed: noBashAvailable },
    { name: "not_called", passed: bashNotCalled },
  ];
}

runTests({
  name: "nobash tests",
  fixture: "nobash.ts",
  validator,
});
