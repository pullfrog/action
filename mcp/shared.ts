import type { StandardSchemaV1 } from "@standard-schema/spec";
import { encode as toonEncode } from "@toon-format/toon";
import type { FastMCP, Tool } from "fastmcp";
import type { ToolContext } from "../main.ts";
import { formatJsonValue, log } from "../utils/cli.ts";

export const tool = <const params>(toolDef: Tool<any, StandardSchemaV1<params>>) => toolDef;

export interface ToolResult {
  content: {
    type: "text";
    text: string;
  }[];
  isError?: boolean;
}

export const handleToolSuccess = (data: Record<string, any> | string): ToolResult => {
  const text = typeof data === "string" ? data : toonEncode(data);
  return {
    content: [{ type: "text", text }],
  };
};

export const handleToolError = (error: unknown): ToolResult => {
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

/**
 * Helper to wrap a tool execute function with error handling.
 * Captures ctx in closure so tools don't need to handle try/catch.
 * @param fn - the function to execute
 * @param toolName - optional tool name for error logging
 */
export const execute = <T>(
  fn: (params: T) => Promise<Record<string, any> | string>,
  toolName?: string
) => {
  return async (params: T): Promise<ToolResult> => {
    try {
      const result = await fn(params);
      return handleToolSuccess(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const prefix = toolName ? `[${toolName}]` : "tool";
      log.error(`${prefix} error: ${errorMessage}`);
      log.debug(`${prefix} params: ${formatJsonValue(params)}`);
      return handleToolError(error);
    }
  };
};

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

export const addTools = (ctx: ToolContext, server: FastMCP, tools: Tool<any, any>[]) => {
  // sanitize schemas for gemini agent and opencode (when using Google API)
  // both have issues with draft-2020-12 schemas and any_of enum constructs
  const shouldSanitize = ctx.agent.name === "gemini" || ctx.agent.name === "opencode";

  for (const tool of tools) {
    const processedTool = shouldSanitize ? sanitizeTool(tool) : tool;
    server.addTool(processedTool);
  }
  return server;
};
