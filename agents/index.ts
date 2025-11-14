import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";
import { jules } from "./jules.ts";

export const agents = {
  claude,
  codex,
  cursor,
  jules,
} as const;

export type AgentInputKey = (typeof agents)[keyof typeof agents]["inputKey"];
