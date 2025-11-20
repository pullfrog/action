import { cached } from "@ark/util";
import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import { log } from "../utils/cli.ts";
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

export const tool = <const params>(toolDef: Tool<any, StandardSchemaV1<params>>) => {
  // Wrap the execute function to add logging with the tool name
  const toolName = toolDef.name;
  const originalExecute = toolDef.execute;

  toolDef.execute = async (args: params, context: any) => {
    try {
      const result = await originalExecute(args, context);
      // Check if result is a ToolResult with isError property
      const isError =
        result && typeof result === "object" && "isError" in result && result.isError === true;
      const resultData =
        result && typeof result === "object" && "content" in result
          ? (result as ToolResult).content[0]?.text
          : undefined;

      if (isError && resultData) {
        log.toolCall({ toolName, request: args, error: resultData });
      } else if (resultData) {
        log.toolCall({ toolName, request: args, result: resultData });
      } else {
        log.toolCall({ toolName, request: args });
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.toolCall({ toolName, request: args, error: errorMessage });
      throw error;
    }
  };

  return toolDef;
};

// recursively remove $schema fields from JSON Schema objects
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

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  for (const tool of tools) {
    // clone tool and remove $schema from parameters schema
    const cleanedTool = {
      ...tool,
      parameters: tool.parameters ? removeSchemaFields(tool.parameters) : undefined,
    };
    server.addTool(cleanedTool);
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
