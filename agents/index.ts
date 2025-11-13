import { claude } from "./claude.ts";
import { codex } from "./codex.ts";

export const agents = {
  claude,
  codex,
} as const;

export type AgentInputKey = (typeof agents)[keyof typeof agents]["inputKey"];
