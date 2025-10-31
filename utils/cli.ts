/**
 * CLI output utilities that work well in both local and GitHub Actions environments
 */

import * as core from "@actions/core";

const isGitHubActions = !!process.env.GITHUB_ACTIONS;

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
            currentLine = word;
          } else {
            wrappedLines.push(word.substring(0, maxWidth - padding * 2));
            currentLine = word.substring(maxWidth - padding * 2);
          }
        }
      }

      if (currentLine) {
        wrappedLines.push(currentLine);
      }
    }
  }

  const maxLineLength = Math.max(...wrappedLines.map((line) => line.length));
  const boxWidth = maxLineLength + padding * 2;

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
  core.info(boxString(text, options));
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
      summary.addHeading(title);
    }
    summary.addTable(formattedRows);
    await summary.write();
  }

  // Also log to console for visibility
  if (title) {
    core.info(`\n${title}`);
  }
  const tableText = formattedRows.map((row) => row.map((cell) => cell.data).join(" | ")).join("\n");
  core.info(`\n${tableText}\n`);
}

/**
 * Print a separator line
 */
function separator(length: number = 50): void {
  core.info("─".repeat(length));
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
  },

  /**
   * Print warning message
   */
  warning: (message: string): void => {
    core.warning(message);
  },

  /**
   * Print error message
   */
  error: (message: string): void => {
    core.error(message);
  },

  /**
   * Print success message
   */
  success: (message: string): void => {
    core.info(`✅ ${message}`);
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
   * Print a separator line
   */
  separator,
};
