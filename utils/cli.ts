/**
 * CLI utilities
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// re-export logging utilities for backward compatibility
export { formatIndentedField, formatJsonValue, log, writeSummary } from "./log.ts";

/**
 * Finds a CLI executable path by checking if it's installed globally
 * @param name The name of the CLI executable to find
 * @returns The path to the CLI executable, or null if not found
 */
export function findCliPath(name: string): string | null {
  const result = spawnSync("which", [name], { encoding: "utf-8" });
  if (result.status === 0 && result.stdout) {
    const cliPath = result.stdout.trim();
    if (cliPath && existsSync(cliPath)) {
      return cliPath;
    }
  }
  return null;
}
