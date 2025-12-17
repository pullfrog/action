import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { $ } from "../utils/shell.ts";
import { execute, tool } from "./shared.ts";

export const DebugShellCommand = type({});

export function DebugShellCommandTool(_ctx: ToolContext) {
  return tool({
    name: "debug_shell_command",
    description:
      "debug tool: runs 'git status' and returns the output. use this to test shell command execution in the MCP server.",
    parameters: DebugShellCommand,
    execute: execute(async () => {
      const result = $("git", ["status"]);
      return {
        success: true,
        command: "git status",
        output: result.trim(),
      };
    }),
  });
}
