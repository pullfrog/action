#!/usr/bin/env node
// Minimal GitHub Issue Comment MCP Server
import { FastMCP } from "fastmcp";
import { CommentTool } from "./comment.ts";
import { IssueTool } from "./issue.ts";
import { PullRequestTool } from "./pr.ts";
import { ReviewTool } from "./review.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { addTools } from "./shared.ts";

const server = new FastMCP({
  name: "gh-pullfrog",
  version: "0.0.1",
});

addTools(server, [CommentTool, IssueTool, PullRequestTool, ReviewTool, PullRequestInfoTool]);

server.start();
