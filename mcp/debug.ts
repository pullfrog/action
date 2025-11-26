import { type } from "arktype";
import { $ } from "../utils/shell.ts";
import type { ToolResult } from "./shared.ts";
import { tool } from "./shared.ts";

export const DebugShellCommand = type({});

export const DebugShellCommandTool = tool({
  name: "debug_shell_command",
  description:
    "debug tool: runs 'git status' and returns the output. use this to test shell command execution in the MCP server.",
  parameters: DebugShellCommand,
  execute: async (): Promise<ToolResult> => {
    try {
      const result = $("git", ["status"]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                command: "git status",
                output: result.trim(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});
