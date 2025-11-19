import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";
import { gemini } from "./gemini.ts";

export const agents = {
  claude,
  codex,
  cursor,
  gemini,
} as const;

export type AgentInputKey = (typeof agents)[keyof typeof agents]["inputKeys"][number];
