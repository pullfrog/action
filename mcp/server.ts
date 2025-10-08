#!/usr/bin/env node
// Minimal GitHub Issue Comment MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { type } from "arktype";
import { z } from "zod";

// Get repository information from environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!REPO_OWNER || !REPO_NAME) {
  console.error("Error: REPO_OWNER and REPO_NAME environment variables are required");
  process.exit(1);
}

const server = new McpServer({
  name: "Minimal GitHub Issue Comment Server",
  version: "0.0.1",
});

// Define the schema for creating issue comments
const Comment = type({
  issueNumber: type.number.describe("the issue number to comment on"),
  body: type.string.describe("the comment body content"),
});

server.tool(
  "create_issue_comment",
  "Create a comment on a GitHub issue",
  {
    issueNumber: z.number().describe("the issue number to comment on"),
    body: z.string().describe("the comment body content"),
  },
  async ({ issueNumber, body }) => {
    try {
      // Validate input using arktype
      const validation = Comment({ issueNumber, body });
      if (validation instanceof type.errors) {
        throw new Error(`Invalid input: ${validation.summary}`);
      }

      const githubInstallationToken = process.env.GITHUB_INSTALLATION_TOKEN;
      if (!githubInstallationToken) {
        throw new Error("GITHUB_INSTALLATION_TOKEN environment variable is required");
      }

      const octokit = new Octokit({
        auth: githubInstallationToken,
      });

      const result = await octokit.rest.issues.createComment({
        owner: REPO_OWNER,
        repo: REPO_NAME,
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

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
