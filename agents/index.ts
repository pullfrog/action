import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { gemini } from "./gemini.ts";

export const agents = {
  claude,
  codex,
  gemini,
} as const;

export type AgentInputKey = (typeof agents)[keyof typeof agents]["inputKeys"][number];
