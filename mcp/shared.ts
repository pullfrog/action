import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import type { Payload } from "../external.ts";
import { getGitHubInstallationToken, parseRepoContext, type RepoContext } from "../utils/github.ts";

export interface ToolResult {
  content: {
    type: "text";
    text: string;
  }[];
  isError?: boolean;
}

export function getPayload(): Payload {
  const payloadEnv = process.env.PULLFROG_PAYLOAD;
  if (!payloadEnv) {
    throw new Error("PULLFROG_PAYLOAD environment variable is required");
  }

  try {
    return JSON.parse(payloadEnv) as Payload;
  } catch (error) {
    throw new Error(
      `Failed to parse PULLFROG_PAYLOAD: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function getMcpContext(): McpContext {
  return {
    ...parseRepoContext(),
    octokit: new Octokit({
      auth: getGitHubInstallationToken(),
    }),
    payload: getPayload(),
  };
}

export interface McpContext extends RepoContext {
  octokit: Octokit;
  payload: Payload;
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
