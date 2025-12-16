import { type } from "arktype";
import { $ } from "../utils/shell.ts";
import { handleToolError, handleToolSuccess, tool, type ToolResult } from "./shared.ts";

export const ListFiles = type({
  path: type.string
    .describe("The path to list files from (defaults to current directory)")
    .default("."),
});

// static tool - doesn't need ctx, just runs git/find commands
export const ListFilesTool = tool({
  name: "list_files",
  description:
    "List files in the repository using git ls-files. Useful for discovering the file structure and locating files.",
  parameters: ListFiles,
  execute: async ({ path }: { path?: string }): Promise<ToolResult> => {
    try {
      // Use git ls-files to list tracked files
      // This respects .gitignore and gives a clean list of source files
      const pathStr = path ?? ".";
      const output = $("git", pathStr === "." ? ["ls-files"] : ["ls-files", pathStr], {
        log: false,
      });
      const files = output.split("\n").filter((f) => f.trim() !== "");

      if (files.length === 0) {
        // Fallback for non-git environments or untracked files
        const findOutput = $(
          "find",
          [pathStr, "-maxdepth", "3", "-not", "-path", "*/.*", "-type", "f"],
          { log: false }
        );
        return handleToolSuccess({
          files: findOutput.split("\n").filter((f) => f.trim() !== ""),
          method: "find",
        });
      }

      return handleToolSuccess({ files, method: "git" });
    } catch (error) {
      return handleToolError(error);
    }
  },
});
