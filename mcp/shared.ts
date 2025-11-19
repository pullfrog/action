import { appendFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Get the log file path
 */
function getLogPath(): string {
  return join(process.cwd(), "log.txt");
}

/**
 * Log MCP tool call information to log.txt
 */
function logToolCall({
  toolName,
  request,
  error,
  success,
}: {
  toolName: string;
  request: unknown;
  error?: unknown;
  success?: boolean;
}): void {
  try {
    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    const requestStr = JSON.stringify(request, null, 2);

    let logEntry = `[${timestamp}] Tool: ${toolName}\n`;
    logEntry += `Request: ${requestStr}\n`;

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logEntry += `Error: ${errorMessage}\n`;
      if (errorStack) {
        logEntry += `Stack: ${errorStack}\n`;
      }
      logEntry += `Status: FAILED\n`;
    } else if (success !== undefined) {
      logEntry += `Status: ${success ? "SUCCESS" : "FAILED"}\n`;
    }

    logEntry += `${"=".repeat(80)}\n\n`;
    appendFileSync(logPath, logEntry, "utf-8");
  } catch {
    // Silently fail if logging fails to avoid breaking the tool
  }
}

export const tool = <const params>(toolDef: Tool<any, StandardSchemaV1<params>>) => {
  // Wrap the execute function to add logging with the tool name
  const toolName = toolDef.name;
  const originalExecute = toolDef.execute;

  toolDef.execute = async (args: params, context: any) => {
    try {
      logToolCall({ toolName, request: args });
      const result = await originalExecute(args, context);
      // Check if result is a ToolResult with isError property
      const isError =
        result && typeof result === "object" && "isError" in result && result.isError === true;
      logToolCall({ toolName, request: args, success: !isError });
      return result;
    } catch (error) {
      logToolCall({ toolName, request: args, error });
      throw error;
    }
  };

  return toolDef;
};

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
