import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";

export const tool = <const params>(tool: Tool<{}, StandardSchemaV1<params>>) => tool;

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  for (const tool of tools) {
    server.addTool(tool);
  }
  return server;
};
