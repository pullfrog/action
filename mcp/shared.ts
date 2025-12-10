import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import type { Payload } from "../external.ts";
import type { Mode } from "../modes.ts";
import { getGitHubInstallationToken, parseRepoContext, type RepoContext } from "../utils/github.ts";

export interface McpInitContext {
  payload: Payload;
  modes: Mode[];
  agentName?: string;
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

export function isProgressCommentDisabled(): boolean {
  return mcpInitContext?.payload.disableProgressComment === true;
}

export const tool = <const params>(toolDef: Tool<any, StandardSchemaV1<params>>) => toolDef;

/**
 * Sanitize JSON schema to remove problematic fields that Gemini CLI/API can't handle
 * - Removes $schema field (causes "no schema with key or ref" errors)
 * - Converts $defs to definitions (draft-07 compatibility)
 * - Removes any draft-2020-12 specific features
 * - Converts any_of with enum values to direct STRING enum (Google API requirement)
 */
function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }

  // handle any_of with enum values - convert to direct STRING enum for Google API
  // Google API requires: {type: "string", enum: [...]} not {anyOf: [{enum: [...]}, {enum: [...]}]}
  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const enumValues: string[] = [];
    let allAreEnumObjects = true;

    for (const item of schema.anyOf) {
      if (item && typeof item === "object" && Array.isArray(item.enum)) {
        // collect enum values (only strings)
        const stringEnums = item.enum.filter((v: any) => typeof v === "string");
        if (stringEnums.length > 0) {
          enumValues.push(...stringEnums);
        } else {
          allAreEnumObjects = false;
          break;
        }
      } else {
        allAreEnumObjects = false;
        break;
      }
    }

    // if all any_of items are enum objects with string values, convert to direct STRING enum
    if (allAreEnumObjects && enumValues.length > 0) {
      const uniqueEnums = [...new Set(enumValues)];
      // preserve other properties from the original schema (like description)
      const result: any = {
        type: "string",
        enum: uniqueEnums,
      };
      if (schema.description) {
        result.description = schema.description;
      }
      return result;
    }
  }

  const sanitized: any = {};

  for (const [key, value] of Object.entries(schema)) {
    // skip $schema field entirely
    if (key === "$schema") {
      continue;
    }

    // skip any_of if we already converted it above
    if (key === "anyOf" && schema.anyOf) {
      continue;
    }

    // convert $defs to definitions for draft-07 compatibility
    if (key === "$defs") {
      sanitized.definitions = sanitizeSchema(value);
      continue;
    }

    // recursively sanitize nested objects
    sanitized[key] = sanitizeSchema(value);
  }

  return sanitized;
}

/**
 * Wrap a StandardSchemaV1 to intercept toJsonSchema() calls and sanitize the output
 */
function wrapSchema(schema: StandardSchemaV1<any>): StandardSchemaV1<any> {
  const originalToJsonSchema = (schema as any).toJsonSchema?.bind(schema);

  if (!originalToJsonSchema) {
    return schema;
  }

  // create a proxy that intercepts toJsonSchema calls
  return new Proxy(schema, {
    get(target, prop) {
      if (prop === "toJsonSchema") {
        return () => {
          const originalSchema = originalToJsonSchema();
          return sanitizeSchema(originalSchema);
        };
      }
      return (target as any)[prop];
    },
  }) as StandardSchemaV1<any>;
}

/**
 * Transform tool to sanitize its parameter schema for Gemini CLI compatibility
 */
function sanitizeTool<T extends Tool<any, any>>(tool: T): T {
  if (!tool.parameters) {
    return tool;
  }

  // wrap the schema object to intercept toJsonSchema() calls
  const wrappedSchema = wrapSchema(tool.parameters);

  // create a new tool with wrapped schema
  return {
    ...tool,
    parameters: wrappedSchema,
  } as T;
}

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  // sanitize schemas for gemini agent and opencode (when using Google API)
  // both have issues with draft-2020-12 schemas and any_of enum constructs
  const shouldSanitize =
    mcpInitContext?.agentName === "gemini" || mcpInitContext?.agentName === "opencode";

  for (const tool of tools) {
    const processedTool = shouldSanitize ? sanitizeTool(tool) : tool;
    server.addTool(processedTool);
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
