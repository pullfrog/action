import type { show } from "@ark/util";
import { type AgentManifest, type AgentName, agentsManifest, type Effort } from "../external.ts";
import { log } from "../utils/cli.ts";

/**
 * Result returned by agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
  metadata?: Record<string, unknown>;
}

/**
 * Tool permission levels
 */
export type ToolPermission = "disabled" | "enabled";
export type BashPermission = "disabled" | "restricted" | "enabled";

/**
 * Granular tool permissions for agents
 */
export interface ToolPermissions {
  web: ToolPermission;
  search: ToolPermission;
  write: ToolPermission;
  bash: BashPermission;
}

/**
 * Minimal context passed to agent.run()
 */
export interface AgentRunContext {
  effort: Effort;
  tools: ToolPermissions;
  mcpServerUrl: string;
  tmpdir: string;
  instructions: string;
  apiKey: string;
  apiKeys: Record<string, string>;
}

export const agent = <const input extends AgentInput>(input: input): defineAgent<input> => {
  return {
    ...input,
    run: async (ctx: AgentRunContext): Promise<AgentResult> => {
      log.info(`» running ${input.name} with effort=${ctx.effort}...`);
      log.box(ctx.instructions, { title: "Instructions" });
      log.info(
        `» tool permissions: web=${ctx.tools.web}, search=${ctx.tools.search}, write=${ctx.tools.write}, bash=${ctx.tools.bash}`
      );
      return input.run(ctx);
    },
    ...agentsManifest[input.name],
  } as never;
};

export interface AgentInput {
  name: AgentName;
  install: (token?: string) => Promise<string>;
  run: (ctx: AgentRunContext) => Promise<AgentResult>;
}

export interface Agent extends AgentInput, AgentManifest {}

type agentManifest<name extends AgentName> = (typeof agentsManifest)[name];

type defineAgent<input extends AgentInput> = show<input & agentManifest<input["name"]>>;
