import { cached } from "@ark/util";
import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import { parseRepoContext, type RepoContext } from "../utils/github.ts";

export interface ToolResult {
  content: {
    type: "text";
    text: string;
  }[];
  isError?: boolean;
}

export const getMcpContext = cached((): McpContext => {
  const githubInstallationToken = process.env.GITHUB_INSTALLATION_TOKEN;
  if (!githubInstallationToken) {
    throw new Error("GITHUB_INSTALLATION_TOKEN environment variable is required");
  }

  return {
    ...parseRepoContext(),
    octokit: new Octokit({
      auth: githubInstallationToken,
    }),
  };
});

export interface McpContext extends RepoContext {
  octokit: Octokit;
}

export const tool = <const params>(tool: Tool<any, StandardSchemaV1<params>>) => tool;

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  for (const tool of tools) {
    server.addTool(tool);
  }
  return server;
};

export const contextualize =
  <T>(executor: (params: T, ctx: McpContext) => Promise<Record<string, any>>) =>
  async (params: T): Promise<ToolResult> => {
    try {
      const ctx = getMcpContext();
      const result = await executor(params, ctx);
      return handleToolSuccess(result);
    } catch (error) {
      return handleToolError(error);
    }
  };

const handleToolSuccess = (data: Record<string, any>): ToolResult => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
};

const handleToolError = (error: unknown): ToolResult => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `Error: ${errorMessage}`,
      },
    ],
    isError: true,
  };
};
