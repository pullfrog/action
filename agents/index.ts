import type { AgentName } from "../external.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";
import { gemini } from "./gemini.ts";
import type { Agent } from "./shared.ts";

export const agents = {
  claude,
  codex,
  cursor,
  gemini,
} satisfies Record<AgentName, Agent>;
