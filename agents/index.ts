import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";

export const agents = {
  claude,
  codex,
  cursor,
} as const;

export type AgentInputKey = (typeof agents)[keyof typeof agents]["inputKey"];
