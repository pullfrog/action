/**
 * CLI output utilities for GitHub Actions and local development
 * Uses GitHub Actions Job Summaries API when available for rich formatting
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
 * In GitHub Actions, uses markdown code blocks; locally uses box formatting
 */
function box(
  text: string,
  options?: {
    title?: string;
    maxWidth?: number;
  }
): void {
  if (isGitHubActions) {
    const { title } = options || {};
    let markdown = "";
    if (title) {
      markdown += `### ${title}\n\n`;
    }
    markdown += "```\n";
    markdown += text;
    markdown += "\n```\n";
    // Note: summary.write() should be called once at the end, but for immediate visibility we call it here
    // In practice, you might want to batch multiple calls
    core.summary.addRaw(markdown);
    core.info(markdown);
  } else {
    log.info(boxString(text, options));
  }
}

/**
 * Add a table using GitHub Actions Job Summaries API
 * Falls back to formatted console table locally
 */
async function table(
  rows: Array<Array<{ data: string; header?: boolean } | string>>,
  options?: {
    title?: string;
  }
): Promise<void> {
  const { title } = options || {};

  if (isGitHubActions) {
    const summary = core.summary;

    if (title) {
      summary.addHeading(title);
    }

    // Convert rows to format expected by Job Summaries API
    const formattedRows = rows.map((row) =>
      row.map((cell) => {
        if (typeof cell === "string") {
          return { data: cell };
        }
        return cell;
      })
    );

    summary.addTable(formattedRows);
    await summary.write();

    // Also log to console for visibility in logs
    const tableText = formattedRows
      .map((row) => row.map((cell) => cell.data).join(" | "))
      .join("\n");
    log.info(tableText);
  } else {
    // Local fallback: simple console table
    if (title) {
      log.info(`\n${title}`);
    }
    const tableText = rows
      .map((row) => {
        const rowData = row.map((cell) => {
          const text = typeof cell === "string" ? cell : cell.data;
          const isHeader = typeof cell !== "string" && cell.header;
          return isHeader ? `**${text}**` : text;
        });
        return rowData.join(" | ");
      })
      .join("\n");
    log.info(`\n${tableText}\n`);
  }
}

/**
 * Add raw markdown to job summary (GitHub Actions) or print as info (local)
 */
async function markdown(content: string): Promise<void> {
  if (isGitHubActions) {
    core.summary.addRaw(content);
    await core.summary.write();
    // Also log to console
    core.info(content);
  } else {
    log.info(content);
  }
}

/**
 * Add a code block to output
 */
function codeBlock(code: string, language?: string): void {
  if (isGitHubActions) {
    core.summary.addCodeBlock(code, language);
    core.info(`\`\`\`${language || ""}\n${code}\n\`\`\``);
  } else {
    log.info(`\`\`\`${language || ""}\n${code}\n\`\`\``);
  }
}

/**
 * Add a link to output
 */
function link(text: string, url: string): void {
  if (isGitHubActions) {
    core.summary.addLink(text, url);
    log.info(`[${text}](${url})`);
  } else {
    log.info(`[${text}](${url})`);
  }
}

/**
 * Write all pending summary changes to the job summary
 * Call this at the end of your action to ensure all summary content is written
 */
async function writeSummary(): Promise<void> {
  if (isGitHubActions) {
    await core.summary.write();
  }
}

/**
 * Print a separator line
 */
function separator(length: number = 50): void {
  if (isGitHubActions) {
    core.info("─".repeat(length));
  } else {
    console.log("─".repeat(length));
  }
}

/**
 * Main logging utility object - import this once and access all utilities
 */
export const log = {
  /**
   * Check if running in GitHub Actions environment
   */
  isGitHubActions: (): boolean => isGitHubActions,

  /**
   * Print info message (GitHub Actions or console)
   */
  info: (message: string): void => {
    if (isGitHubActions) {
      core.info(message);
    } else {
      console.log(message);
    }
  },

  /**
   * Print warning message
   */
  warning: (message: string): void => {
    if (isGitHubActions) {
      core.warning(message);
    } else {
      console.warn(`⚠️  ${message}`);
    }
  },

  /**
   * Print error message
   */
  error: (message: string): void => {
    if (isGitHubActions) {
      core.error(message);
    } else {
      console.error(`❌ ${message}`);
    }
  },

  /**
   * Print success message
   */
  success: (message: string): void => {
    const msg = `✅ ${message}`;
    if (isGitHubActions) {
      core.info(msg);
    } else {
      console.log(msg);
    }
  },

  /**
   * Print a formatted box with text
   * In GitHub Actions, uses markdown code blocks; locally uses box formatting
   */
  box,

  /**
   * Add a table using GitHub Actions Job Summaries API
   * Falls back to formatted console table locally
   */
  table,

  /**
   * Add raw markdown to job summary (GitHub Actions) or print as info (local)
   */
  markdown,

  /**
   * Add a code block to output
   */
  codeBlock,

  /**
   * Add a link to output
   */
  link,

  /**
   * Write all pending summary changes to the job summary
   * Call this at the end of your action to ensure all summary content is written
   */
  writeSummary,

  /**
   * Print a separator line
   */
  separator,
};
