/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */

import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { ghPullfrogMcpName } from "../external.ts";

export type McpName = typeof ghPullfrogMcpName;

export type McpConfigs = Record<McpName, McpHttpServerConfig>;

export function createMcpConfigs(mcpServerUrl: string): McpConfigs {
  return {
    [ghPullfrogMcpName]: {
      type: "http",
      url: mcpServerUrl,
    },
  };
}
