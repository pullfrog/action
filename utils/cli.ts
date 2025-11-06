/**
 * CLI output utilities that work well in both local and GitHub Actions environments
 */

import * as core from "@actions/core";

const isGitHubActions = !!process.env.GITHUB_ACTIONS;
const isDebugEnabled = process.env.LOG_LEVEL === "debug";

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
  const tableText = formattedRows.map((row) => row.map((cell) => cell.data).join(" | ")).join("\n");
  core.info(`\n${tableText}\n`);
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
  debug: (message: string): void => {
    if (isDebugEnabled) {
      if (isGitHubActions) {
        core.debug(message);
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
};
