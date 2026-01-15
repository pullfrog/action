/**
 * CLI output utilities that work well in both local and GitHub Actions environments
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as core from "@actions/core";
import { table } from "table";
import { wasSummaryOverwritten } from "../mcp/comment.js";

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
}

/**
 * Overwrite the job summary with the given text.
 */
export function writeSummary(text: string): void {
  if (!isGitHubActions) return;
  core.summary.addRaw(text).write({ overwrite: true });
}

/**
 * Print a formatted table using the table package
 */
function printTable(
  rows: Array<Array<{ data: string; header?: boolean } | string>>,
  options?: {
    title?: string;
  }
): void {
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
}

/**
 * Print a separator line
 */
function separator(length: number = 50): void {
  const separatorText = "─".repeat(length);
  core.info(separatorText);
}

/**
 * Main logging utility object - import this once and access all utilities
 */
export const log = {
  /** Print info message */
  info: (message: string): void => {
    core.info(message);
  },

  /** Print warning message */
  warning: (message: string): void => {
    core.warning(message);
  },

  /** Print error message */
  error: (message: string): void => {
    core.error(message);
  },

  /** Print success message */
  success: (message: string): void => {
    core.info(`✅ ${message}`);
  },

  /** Print debug message (only if LOG_LEVEL=debug) */
  debug: (message: string | unknown): void => {
    if (isDebugEnabled()) {
      core.info(`[DEBUG] ${message}`);
    }
  },

  /** Print a formatted box with text */
  box,

  /** Print a formatted table using the table package */
  table: printTable,

  /** Print a separator line */
  separator,

  /** Start a collapsed group (GitHub Actions) or regular group (local) */
  startGroup,

  /** End a collapsed group */
  endGroup,

  /** Run a callback within a collapsed group */
  group,

  /** Log tool call information to console with formatted output */
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
