import { execSync } from "node:child_process";
import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

export const ListFiles = type({
  path: type.string
    .describe("The path to list files from (defaults to current directory)")
    .default("."),
});

export const ListFilesTool = tool({
  name: "list_files",
  description:
    "List files in the repository using git ls-files. Useful for discovering the file structure and locating files.",
  parameters: ListFiles,
  execute: contextualize(async ({ path }) => {
    try {
      // Use git ls-files to list tracked files
      // This respects .gitignore and gives a clean list of source files
      const command = path === "." ? "git ls-files" : `git ls-files ${path}`;
      const output = execSync(command, { encoding: "utf-8" });
      const files = output.split("\n").filter((f) => f.trim() !== "");

      if (files.length === 0) {
        // Fallback for non-git environments or untracked files
        const findCmd = `find ${path} -maxdepth 3 -not -path '*/.*' -type f`;
        const findOutput = execSync(findCmd, { encoding: "utf-8" });
        return {
          files: findOutput.split("\n").filter((f) => f.trim() !== ""),
          method: "find",
        };
      }

      return { files, method: "git" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        error: `Failed to list files: ${errorMessage}`,
        hint: "Try using a specific path if the repository root is not the current directory.",
      };
    }
  }),
});
