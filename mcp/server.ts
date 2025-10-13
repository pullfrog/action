#!/usr/bin/env node
import { writeFileSync } from "node:fs";
// Minimal GitHub Issue Comment MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { type } from "arktype";
import { z } from "zod";
import { resolveRepoContext } from "../utils/repo-context.ts";

// Simple error logging to file
function logError(message: string, error?: any) {
  const timestamp = new Date().toISOString();
  const errorText = error ? `\nError: ${error.message}\nStack: ${error.stack}` : "";
  const logEntry = `[${timestamp}] ${message}${errorText}\n`;

  try {
    writeFileSync("/tmp/mcp-error.log", logEntry, { flag: "a" });
    console.error(logEntry);
  } catch (writeError) {
    console.error(`Failed to write error log: ${writeError}`);
    console.error(logEntry);
  }
}

let server: McpServer;

try {
  logError("Creating MCP server...");
  server = new McpServer({
    name: "Minimal GitHub Issue Comment Server",
    version: "0.0.1",
  });
  logError("MCP server created successfully");
} catch (error) {
  logError("Failed to create MCP server", error);
  process.exit(1);
}

// Define the schema for creating issue comments
const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

try {
  logError("Registering create_issue_comment tool...");

  server.tool(
    "create_issue_comment",
    "Create a comment on a GitHub issue",
    {
      issueNumber: z.number().describe("the issue number to comment on"),
      body: z.string().describe("the comment body content"),
    },
    async ({ issueNumber, body }) => {
      try {
        Comment.assert({ issueNumber, body });

        const githubInstallationToken = process.env.GITHUB_INSTALLATION_TOKEN;
        if (!githubInstallationToken) {
          throw new Error("GITHUB_INSTALLATION_TOKEN environment variable is required");
        }

        // Resolve repository context from environment
        const repoContext = resolveRepoContext();

        const octokit = new Octokit({
          auth: githubInstallationToken,
        });

        const result = await octokit.rest.issues.createComment({
          owner: repoContext.owner,
          repo: repoContext.name,
          issue_number: issueNumber,
          body: body,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  commentId: result.data.id,
                  url: result.data.html_url,
                  body: result.data.body,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError("Tool execution failed", error);
        return {
          content: [
            {
              type: "text",
              text: `Error creating comment: ${errorMessage}`,
            },
          ],
          error: errorMessage,
          isError: true,
        };
      }
    }
  );

  logError("Tool registered successfully");
} catch (error) {
  logError("Failed to register tool", error);
  process.exit(1);
}

async function runServer() {
  try {
    logError("Starting MCP server...");

    const transport = new StdioServerTransport();
    logError("Transport created, attempting connection...");

    await server.connect(transport);
    logError("MCP server connected successfully");

    process.on("exit", () => {
      logError("Process exiting, closing server...");
      server.close();
    });

    process.on("SIGTERM", () => {
      logError("SIGTERM received, closing server...");
      server.close();
      process.exit(0);
    });

    process.on("SIGINT", () => {
      logError("SIGINT received, closing server...");
      server.close();
      process.exit(0);
    });
  } catch (error) {
    logError("Server startup failed", error);
    process.exit(1);
  }
}

logError("Initializing MCP server process...");

runServer().catch((error) => {
  logError("Unhandled server error", error);
  process.exit(1);
});
