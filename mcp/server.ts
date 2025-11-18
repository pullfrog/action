#!/usr/bin/env node
// Minimal GitHub Issue Comment MCP Server
import { FastMCP } from "fastmcp";
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
import { addTools, initLogFile } from "./shared.ts";

// Initialize log file when server starts
initLogFile();

const server = new FastMCP({
  name: "gh-pullfrog",
  version: "0.0.1",
});

addTools(server, [
  CreateCommentTool,
  EditCommentTool,
  CreateWorkingCommentTool,
  UpdateWorkingCommentTool,
  IssueTool,
  PullRequestTool,
  ReviewTool,
  PullRequestInfoTool,
]);

server.start();
