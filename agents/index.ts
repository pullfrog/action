import type { AgentName } from "../main.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import type { Agent } from "./shared.ts";

export const agents = {
  claude,
  codex,
} as const satisfies Record<AgentName, Agent>;
