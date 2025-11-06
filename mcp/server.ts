#!/usr/bin/env node
// Minimal GitHub Issue Comment MCP Server
import { FastMCP } from "fastmcp";
import { CreateCommentTool, EditCommentTool } from "./comment.ts";
import { IssueTool } from "./issue.ts";
import { PullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { ReviewTool } from "./review.ts";
import { addTools } from "./shared.ts";

export function createMcpServer(): void {
  const server = new FastMCP({
    name: "gh-pullfrog",
    version: "0.0.1",
  });

  addTools(server, [
    CreateCommentTool,
    EditCommentTool,
    IssueTool,
    PullRequestTool,
    ReviewTool,
    PullRequestInfoTool,
  ]);

  server.start();
}
