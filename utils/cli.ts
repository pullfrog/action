/**
 * CLI output utilities that work well in both local and GitHub Actions environments
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { table } from "table";

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
   * Log MCP tool call information to mcpLog.txt in the temp directory
   */
  toolCall: ({
    toolName,
    request,
    result,
    error,
  }: {
    toolName: string;
    request: unknown;
    result?: string;
    error?: string;
  }): void => {
    const logPath = getMcpLogPath();
    const params: Parameters<typeof formatToolCall>[0] = { toolName, request };
    if (error) {
      params.error = error;
    } else if (result) {
      params.result = result;
    }
    const logEntry = formatToolCall(params);
    appendFileSync(logPath, logEntry, "utf-8");
  },
};

/**
 * Get the path to the MCP log file in the temp directory
 */
function getMcpLogPath(): string {
  const tempDir = process.env.PULLFROG_TEMP_DIR!;
  return join(tempDir, "mcpLog.txt");
}

/**
 * Format a value as JSON, using compact format for simple values and pretty-printed for complex ones
 */
function formatJsonValue(value: unknown): string {
  const compact = JSON.stringify(value);
  return compact.length > 80 || compact.includes("\n") ? JSON.stringify(value, null, 2) : compact;
}

/**
 * Format a multi-line string with proper indentation for tool call output
 * First line has the label, subsequent lines are indented 4 spaces
 */
function formatIndentedField(label: string, content: string): string {
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
 * Format the input field for a tool call
 */
function formatToolInput(request: unknown): string {
  const requestFormatted = formatJsonValue(request);
  if (requestFormatted === "{}") {
    return "";
  }
  return formatIndentedField("input", requestFormatted);
}

/**
 * Format the result field for a tool call, parsing JSON if possible
 */
function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    const formatted = formatJsonValue(parsed);
    return formatIndentedField("result", formatted);
  } catch {
    // Not JSON, display as-is
    return formatIndentedField("result", result);
  }
}

/**
 * Format a complete tool call entry with tool name, input, result, and error
 */
function formatToolCall({
  toolName,
  request,
  result,
  error,
}: {
  toolName: string;
  request: unknown;
  result?: string;
  error?: string;
}): string {
  let logEntry = `→ ${toolName}\n`;

  logEntry += formatToolInput(request);

  if (error) {
    logEntry += formatIndentedField("error", error);
  } else if (result) {
    logEntry += formatToolResult(result);
  }

  logEntry += "\n";
  return logEntry;
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
