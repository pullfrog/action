import { type } from "arktype";
import { $ } from "../utils/shell.ts";
import { handleToolError, handleToolSuccess, tool, type ToolResult } from "./shared.ts";

export const DebugShellCommand = type({});

export const DebugShellCommandTool = tool({
  name: "debug_shell_command",
  description:
    "debug tool: runs 'git status' and returns the output. use this to test shell command execution in the MCP server.",
  parameters: DebugShellCommand,
  execute: async (): Promise<ToolResult> => {
    try {
      const result = $("git", ["status"]);
      return handleToolSuccess({
        success: true,
        command: "git status",
        output: result.trim(),
      });
    } catch (error) {
      return handleToolError(error);
    }
  },
});
