import "./arkConfig.ts";
// this must be imported first
import { FastMCP } from "fastmcp";
import { ghPullfrogMcpName } from "../external.ts";
import { GetCheckSuiteLogsTool } from "./checkSuite.ts";
import {
  CreateCommentTool,
  CreateWorkingCommentTool,
  EditCommentTool,
  UpdateWorkingCommentTool,
} from "./comment.ts";
import { IssueTool } from "./issue.ts";
import { PullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { ReviewTool } from "./review.ts";
import { GetReviewCommentsTool, ListPullRequestReviewsTool } from "./reviewComments.ts";
import { SelectModeTool } from "./selectMode.ts";
import { addTools } from "./shared.ts";

const server = new FastMCP({
  name: ghPullfrogMcpName,
  version: "0.0.1",
});

addTools(server, [
  SelectModeTool,
  CreateCommentTool,
  EditCommentTool,
  CreateWorkingCommentTool,
  UpdateWorkingCommentTool,
  IssueTool,
  PullRequestTool,
  ReviewTool,
  PullRequestInfoTool,
  GetReviewCommentsTool,
  ListPullRequestReviewsTool,
  GetCheckSuiteLogsTool,
]);

// intercept stdout to remove $schema fields from JSON-RPC messages
// FastMCP uses stdout for JSON-RPC communication, so we intercept here
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk: any, encoding?: any, cb?: any): boolean {
  if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
    try {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      // MCP uses JSON-RPC over stdio, messages are JSON objects on single lines
      const lines = text.split("\n");
      const modifiedLines = lines.map((line) => {
        const trimmed = line.trim();
        // only process lines that look like JSON-RPC messages
        if (trimmed.startsWith("{") && trimmed.includes('"jsonrpc"')) {
          try {
            const parsed = JSON.parse(trimmed);
            // recursively remove $schema fields from the message
            const cleaned = removeSchemaFields(parsed);
            return JSON.stringify(cleaned) + "\n";
          } catch {
            // if parsing fails, return original line
            return line + (line.endsWith("\n") ? "" : "\n");
          }
        }
        return line + (line.endsWith("\n") ? "" : "\n");
      });
      const result = modifiedLines.join("");
      return originalStdoutWrite(result, encoding, cb);
    } catch {
      // if anything fails, just pass through
    }
  }
  return originalStdoutWrite(chunk, encoding, cb);
};

// recursively remove $schema fields from JSON objects
function removeSchemaFields(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeSchemaFields);
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // skip $schema fields
    if (key === "$schema") {
      continue;
    }
    result[key] = removeSchemaFields(value);
  }

  return result;
}

server.start();
