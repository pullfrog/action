import { relative, resolve } from "node:path";
import { type } from "arktype";
import { $ } from "../utils/shell.ts";
import { handleToolError, handleToolSuccess, type ToolResult, tool } from "./shared.ts";

export const ListFiles = type({
  path: type.string
    .describe("The path to list files from (defaults to current directory)")
    .default("."),
});

// static tool - doesn't need ctx, just runs git/find commands
export const ListFilesTool = tool({
  name: "list_files",
  description:
    "List files in the repository, including both git-tracked and untracked files. Useful for discovering the file structure and locating files, including newly created files that haven't been committed yet.",
  parameters: ListFiles,
  execute: async ({ path }: { path?: string }): Promise<ToolResult> => {
    try {
      const pathStr = path ?? ".";
      const cwd = process.cwd();

      // Get git-tracked files
      let gitFiles: string[] = [];
      try {
        const gitArgs = pathStr === "." ? ["ls-files"] : ["ls-files", pathStr];
        const gitOutput = $("git", gitArgs, { log: false });
        gitFiles = gitOutput
          .split("\n")
          .filter((f) => f.trim() !== "")
          .map((f) => f.trim());
      } catch {
        // git might fail, that's ok - we'll use find instead
      }

      // Always also check filesystem for untracked files
      // This is important because newly created files won't be in git yet
      let filesystemFiles: string[] = [];
      try {
        const findOutput = $("find", [pathStr, "-not", "-path", "*/.*", "-type", "f"], {
          log: false,
        });
        filesystemFiles = findOutput
          .split("\n")
          .filter((f) => f.trim() !== "")
          .map((f) => {
            const trimmed = f.trim();
            // normalize to relative paths for comparison
            try {
              return relative(cwd, resolve(cwd, trimmed));
            } catch {
              return trimmed;
            }
          });
      } catch {
        // find might fail, that's ok - we'll just use git files
      }

      // Create a Set of git files for efficient lookup
      const gitFilesSet = new Set(gitFiles);

      // Combine both lists, removing duplicates
      const allFiles = [...new Set([...gitFiles, ...filesystemFiles])].sort();

      // Calculate actual untracked count (files in filesystem but not in git)
      const untrackedFiles = filesystemFiles.filter((f) => !gitFilesSet.has(f));
      const untrackedCount = untrackedFiles.length;

      return handleToolSuccess({
        files: allFiles,
        method: "combined",
        trackedCount: gitFiles.length,
        untrackedCount,
      });
    } catch (error) {
      return handleToolError(error);
    }
  },
});
