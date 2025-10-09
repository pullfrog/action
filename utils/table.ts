import { table } from "table";

/**
 * Print a formatted table with consistent styling
 * @param rows - Array of string arrays representing table rows
 * @param options - Optional table configuration
 */

export function tableString(
  rows: string[][],
  options?: {
    title?: string;
    indent?: string;
    drawHorizontalLine?: (lineIndex: number, rowCount: number) => boolean;
  }
): string {
  const {
    title,
    indent = "",
    drawHorizontalLine = (lineIndex: number, rowCount: number) => {
      return lineIndex === 0 || (options?.title && lineIndex === 1) || lineIndex === rowCount;
    },
  } = options || {};

  if (title) {
    rows.unshift([title]);
  }

  const tableOutput = table(rows, {
    drawHorizontalLine,
    border: {
      topBody: `─`,
      topJoin: `┬`,
      topLeft: `┌`,
      topRight: `┐`,

      bottomBody: `─`,
      bottomJoin: `┴`,
      bottomLeft: `└`,
      bottomRight: `┘`,

      bodyLeft: `│`,
      bodyRight: `│`,
      bodyJoin: `│`,

      joinBody: `─`,
      joinLeft: `├`,
      joinRight: `┤`,
      joinJoin: `┼`,
    },
  });

  const indentedOutput = tableOutput.split("\n").join(`\n${indent}`).trim();

  return `${indent}${indentedOutput}`;
}

/**
 * Print a multi-line string in a formatted box with text wrapping
 * @param text - The text to display
 * @param options - Optional configuration for the box
 */
export function boxString(
  text: string,
  options?: {
    title?: string;
    maxWidth?: number;
    indent?: string;
    padding?: number;
  }
): string {
  const { title, maxWidth = 80, indent = "", padding = 1 } = options || {};

  // Clean up the text and split into lines
  const lines = text.trim().split("\n");

  // Word wrap each line to fit within maxWidth
  const wrappedLines: string[] = [];
  for (const line of lines) {
    if (line.length <= maxWidth - padding * 2) {
      wrappedLines.push(line);
    } else {
      // Word wrap the line
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
            // Word is too long, break it
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

  // Find the maximum line length for box sizing
  const maxLineLength = Math.max(...wrappedLines.map((line) => line.length));
  const boxWidth = maxLineLength + padding * 2;

  // Create the box
  const topBorder = "┌" + "─".repeat(boxWidth) + "┐";
  const bottomBorder = "└" + "─".repeat(boxWidth) + "┘";
  const sideBorder = "│";

  let result = "";

  // Add title if provided
  if (title) {
    const titleLine = ` ${title} `;
    const titlePadding = Math.max(0, boxWidth - titleLine.length);
    result += `${indent}┌${titleLine}${"─".repeat(titlePadding)}┐\n`;
  }

  // Add top border (or title border)
  if (!title) {
    result += `${indent}${topBorder}\n`;
  }

  // Add content lines
  for (const line of wrappedLines) {
    const paddedLine = line.padEnd(maxLineLength);
    result += `${indent}${sideBorder}${" ".repeat(padding)}${paddedLine}${" ".repeat(padding)}${sideBorder}\n`;
  }

  // Add bottom border
  result += `${indent}${bottomBorder}`;

  return result;
}
