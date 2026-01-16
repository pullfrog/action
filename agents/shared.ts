import type { show } from "@ark/util";
import { type AgentManifest, type AgentName, agentsManifest } from "../external.ts";
import { log } from "../utils/cli.ts";
import type { ResolvedInstructions } from "../utils/instructions.ts";
import type { ResolvedPayload } from "../utils/payload.ts";

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
 * Minimal context passed to agent.run()
 */
export interface AgentRunContext {
  payload: ResolvedPayload;
  mcpServerUrl: string;
  tmpdir: string;
  instructions: ResolvedInstructions;
}

export const agent = <const input extends AgentInput>(input: input): defineAgent<input> => {
  return {
    ...input,
    run: async (ctx: AgentRunContext): Promise<AgentResult> => {
      const bash = ctx.payload.bash;
      const web = ctx.payload.web;
      const search = ctx.payload.search;
      const write = ctx.payload.write;
      log.info(`» running ${input.name} with effort=${ctx.payload.effort}...`);
      log.box(ctx.instructions.user.trim() + "\n\n" + ctx.instructions.event.trim(), {
        title: "Instructions",
      });
      log.info(`» tool permissions: web=${web}, search=${search}, write=${write}, bash=${bash}`);
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
