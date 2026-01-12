/**
 * CLI output utilities that work well in both local and GitHub Actions environments
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as core from "@actions/core";
import { table } from "table";

const isGitHubActions = !!process.env.GITHUB_ACTIONS;
const isDebugEnabled = () =>
  process.env.LOG_LEVEL === "debug" ||
  process.env.ACTIONS_STEP_DEBUG === "true" ||
  process.env.RUNNER_DEBUG === "1" ||
  core.isDebug();

/**
 * Start a collapsed group (GitHub Actions) or regular group (local)
 */
function startGroup(name: string): void {
  if (isGitHubActions) {
    core.startGroup(name);
  } else {
    console.group(name);
  }
}

/**
 * End a collapsed group
 */
function endGroup(): void {
  if (isGitHubActions) {
    core.endGroup();
  } else {
    console.groupEnd();
  }
}

/**
 * Run a callback within a collapsed group
 */
function group(name: string, fn: () => void): void {
  startGroup(name);
  fn();
  endGroup();
}

/**
 * Print a formatted box with text (for console output)
 */
function boxString(
  text: string,
  options?: {
    title?: string;
    maxWidth?: number;
    indent?: string;
    padding?: number;
  }
): string {
  const { title, maxWidth = 80, indent = "", padding = 1 } = options || {};

  const lines = text.trim().split("\n");
  const wrappedLines: string[] = [];

  for (const line of lines) {
    if (line.length <= maxWidth - padding * 2) {
      wrappedLines.push(line);
    } else {
      const words = line.split(" ");
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (testLine.length <= maxWidth - padding * 2) {
          currentLine = testLine;
        } else {
          if (currentLine) {
            wrappedLines.push(currentLine);
            currentLine = "";
          }
          // wrap long words by breaking them into chunks
          const maxLineLength = maxWidth - padding * 2;
          let remainingWord = word;
          while (remainingWord.length > maxLineLength) {
            wrappedLines.push(remainingWord.substring(0, maxLineLength));
            remainingWord = remainingWord.substring(maxLineLength);
          }
          currentLine = remainingWord;
        }
      }

      if (currentLine) {
        wrappedLines.push(currentLine);
      }
    }
  }

  const maxLineLength = Math.max(...wrappedLines.map((line) => line.length));
  const contentBoxWidth = maxLineLength + padding * 2;

  // ensure box width is at least as wide as the title line when title exists
  const titleLineLength = title ? ` ${title} `.length : 0;
  const boxWidth = Math.max(contentBoxWidth, titleLineLength);

  let result = "";

  if (title) {
    const titleLine = ` ${title} `;
    const titlePadding = Math.max(0, boxWidth - titleLine.length);
    result += `${indent}┌${titleLine}${"─".repeat(titlePadding)}┐\n`;
  }

  if (!title) {
    result += `${indent}┌${"─".repeat(boxWidth)}┐\n`;
  }

  for (const line of wrappedLines) {
    const paddedLine = line.padEnd(maxLineLength);
    result += `${indent}│${" ".repeat(padding)}${paddedLine}${" ".repeat(padding)}│\n`;
  }

  result += `${indent}└${"─".repeat(boxWidth)}┘`;

  return result;
}

/**
 * Print a formatted box with text
 * Works well in both local and GitHub Actions environments
 */
function box(
  text: string,
  options?: {
    title?: string;
    maxWidth?: number;
  }
): void {
  const boxContent = boxString(text, options);
  core.info(boxContent);
  if (isGitHubActions) {
    // Add as markdown code block for summary (no headers)
    core.summary.addRaw(`\`\`\`\n${text}\n\`\`\`\n`);
  }
}

/**
 * Add a table to GitHub Actions job summary (rich formatting)
 * Also logs to console. Only use this once at the end of execution.
 */
async function summaryTable(
  rows: Array<Array<{ data: string; header?: boolean } | string>>,
  options?: {
    title?: string;
  }
): Promise<void> {
  const { title } = options || {};

  // Convert rows to format expected by Job Summaries API
  const formattedRows = rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === "string") {
        return { data: cell };
      }
      return cell;
    })
  );

  if (isGitHubActions) {
    const summary = core.summary;
    if (title) {
      summary.addRaw(`**${title}**\n\n`);
    }
    summary.addTable(formattedRows);
    // Note: Don't write immediately, let it accumulate with other summary content
  }

  // Also log to console for visibility
  if (title) {
    core.info(`\n${title}`);
  }
  const tableData = formattedRows.map((row) => row.map((cell) => cell.data));
  const tableText = isGitHubActions
    ? tableData.map((row) => row.join(" | ")).join("\n")
    : table(tableData);
  core.info(`\n${tableText}\n`);
}

/**
 * Print a formatted table using the table package
 * Also logs to console and GitHub Actions summary
 */
async function printTable(
  rows: Array<Array<{ data: string; header?: boolean } | string>>,
  options?: {
    title?: string;
  }
): Promise<void> {
  const { title } = options || {};

  // Convert rows to string arrays for the table package
  const tableData = rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === "string") {
        return cell;
      }
      return cell.data;
    })
  );

  const formatted = table(tableData);

  if (title) {
    core.info(`\n${title}`);
  }
  core.info(`\n${formatted}\n`);

  if (isGitHubActions) {
    if (title) {
      core.summary.addRaw(`**${title}**\n\n`);
    }
    core.summary.addRaw(`\`\`\`\n${formatted}\n\`\`\`\n`);
  }
}

/**
 * Print a separator line
 */
function separator(length: number = 50): void {
  const separatorText = "─".repeat(length);
  core.info(separatorText);
  if (isGitHubActions) {
    core.summary.addRaw(`---\n`);
  }
}

/**
 * Main logging utility object - import this once and access all utilities
 */
export const log = {
  /**
   * Print info message
   */
  info: (message: string): void => {
    core.info(message);
    if (isGitHubActions) {
      core.summary.addRaw(`${message}\n`);
    }
  },

  /**
   * Print warning message
   */
  warning: (message: string): void => {
    core.warning(message);
    if (isGitHubActions) {
      core.summary.addRaw(`⚠️ ${message}\n`);
    }
  },

  /**
   * Print error message
   */
  error: (message: string): void => {
    core.error(message);
    if (isGitHubActions) {
      core.summary.addRaw(`❌ ${message}\n`);
    }
  },

  /**
   * Print success message
   */
  success: (message: string): void => {
    const successMessage = `✅ ${message}`;
    core.info(successMessage);
    if (isGitHubActions) {
      core.summary.addRaw(`${successMessage}\n`);
    }
  },

  /**
   * Print debug message (only if LOG_LEVEL=debug)
   */
  debug: (message: string | unknown): void => {
    if (isDebugEnabled()) {
      if (isGitHubActions) {
        // using this instead of core.debug
        // because core.debug only logs when ACTIONS_STEP_DEBUG is set to true
        // we are using LOG_LEVEL
        core.info(`[DEBUG] ${message}`);
      } else {
        core.info(`[DEBUG] ${message}`);
      }
    }
  },

  /**
   * Print a formatted box with text
   */
  box,

  /**
   * Add a table to GitHub Actions job summary (rich formatting)
   * Only use this once at the end of execution
   */
  summaryTable,

  /**
   * Print a formatted table using the table package
   */
  table: printTable,

  /**
   * Print a separator line
   */
  separator,

  /**
   * Write all accumulated summary content to the job summary
   * Call this at the end of execution to finalize the summary
   */
  writeSummary: async (): Promise<void> => {
    if (isGitHubActions) {
      await core.summary.write();
    }
  },

  /**
   * Start a collapsed group (GitHub Actions) or regular group (local)
   */
  startGroup,

  /**
   * End a collapsed group
   */
  endGroup,

  /**
   * Run a callback within a collapsed group
   */
  group,

  /**
   * Log tool call information to console with formatted output
   */
  toolCall: ({ toolName, input }: { toolName: string; input: unknown }): void => {
    const inputFormatted = formatJsonValue(input);
    const timestamp = isDebugEnabled() ? ` [${new Date().toISOString()}]` : "";
    const output =
      inputFormatted !== "{}"
        ? `→ ${toolName}(${inputFormatted})${timestamp}`
        : `→ ${toolName}()${timestamp}`;

    log.info(output.trimEnd());
  },
};

/**
 * Format a value as JSON, using compact format for simple values and pretty-printed for complex ones
 */
export function formatJsonValue(value: unknown): string {
  const compact = JSON.stringify(value);
  return compact.length > 80 || compact.includes("\n") ? JSON.stringify(value, null, 2) : compact;
}

/**
 * Format a multi-line string with proper indentation for tool call output
 * First line has the label, subsequent lines are indented 4 spaces
 */
export function formatIndentedField(label: string, content: string): string {
  if (!content.includes("\n")) {
    return `  ${label}: ${content}\n`;
  }

  const lines = content.split("\n");
  let formatted = `  ${label}: ${lines[0]}\n`;
  for (let i = 1; i < lines.length; i++) {
    formatted += `    ${lines[i]}\n`;
  }
  return formatted;
}

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
