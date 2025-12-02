import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import type { Payload } from "../external.ts";
import type { Mode } from "../modes.ts";
import { getGitHubInstallationToken, parseRepoContext, type RepoContext } from "../utils/github.ts";

export interface McpInitContext {
  payload: Payload;
  modes: Mode[];
}

let mcpInitContext: McpInitContext | undefined;

// this must be called on mcp server initialization
export function initMcpContext(state: McpInitContext): void {
  mcpInitContext = state;
}

export interface McpContext extends McpInitContext, RepoContext {
  octokit: Octokit;
}

export function getMcpContext(): McpContext {
  if (!mcpInitContext) {
    throw new Error("MCP context not initialized. Call initializeMcpContext first.");
  }
  return {
    ...mcpInitContext,
    ...parseRepoContext(),
    octokit: new Octokit({
      auth: getGitHubInstallationToken(),
    }),
  };
}

export const tool = <const params>(toolDef: Tool<any, StandardSchemaV1<params>>) => toolDef;

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  for (const tool of tools) {
    server.addTool(tool);
  }
  return server;
};

export const contextualize = <T>(
  executor: (params: T, ctx: McpContext) => Promise<Record<string, any>>
) => {
  return async (params: T): Promise<ToolResult> => {
    try {
      const ctx = getMcpContext();
      const result = await executor(params, ctx);
      return handleToolSuccess(result);
    } catch (error) {
      return handleToolError(error);
    }
  };
};

export interface ToolResult {
  content: {
    type: "text";
    text: string;
  }[];
  isError?: boolean;
}

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
