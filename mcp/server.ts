#!/usr/bin/env node
// Minimal GitHub Issue Comment MCP Server
import { FastMCP } from "fastmcp";
import { CommentTool } from "./comment.ts";
import { addTools } from "./shared.ts";

const server = new FastMCP({
  name: "Minimal GitHub Issue Comment Server",
  version: "0.0.1",
});

addTools(server, [CommentTool]);

server.start();
