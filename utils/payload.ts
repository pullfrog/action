import { isAbsolute, resolve } from "node:path";
import { type } from "arktype";
import {
  AgentName,
  type AgentName as AgentNameType,
  Effort,
  type PayloadEvent,
} from "../external.ts";

// tool permission enum types for inputs
const ToolPermissionInput = type.enumerated("disabled", "enabled");
const BashPermissionInput = type.enumerated("disabled", "restricted", "enabled");

// schema for JSON payload passed via prompt (internal dispatch invocation)
const JsonPayload = type({
  "~pullfrog": "true",
  "agent?": AgentName.or("null"),
  "prompt?": "string",
  "event?": "object",
  "effort?": Effort,
  "web?": ToolPermissionInput,
  "search?": ToolPermissionInput,
  "write?": ToolPermissionInput,
  "bash?": BashPermissionInput,
  "disableProgressComment?": "true",
  "comment_id?": "number|null",
  "issue_id?": "number|null",
  "pr_id?": "number|null",
});

// inputs schema - action inputs from core.getInput()
export const Inputs = type({
  prompt: "string",
  "effort?": Effort,
  "agent?": AgentName.or("null"),
  "web?": ToolPermissionInput,
  "search?": ToolPermissionInput,
  "write?": ToolPermissionInput,
  "bash?": BashPermissionInput,
  "cwd?": "string|null",
});

export type Inputs = typeof Inputs.infer;

function isAgentName(value: unknown): value is AgentNameType {
  return typeof value === "string" && AgentName(value) instanceof type.errors === false;
}

function isPayloadEvent(value: unknown): value is PayloadEvent {
  return typeof value === "object" && value !== null && "trigger" in value;
}

function resolveCwd(cwd: string | null | undefined): string | null {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!cwd) return workspace ?? null;
  if (isAbsolute(cwd)) return cwd;
  return workspace ? resolve(workspace, cwd) : cwd;
}

export function resolvePayload(core: {
  getInput: (name: string, options?: { required?: boolean }) => string;
}) {
  const inputs = Inputs.assert({
    prompt: core.getInput("prompt", { required: true }),
    effort: core.getInput("effort") || "auto",
    agent: core.getInput("agent") || null,
    cwd: core.getInput("cwd") || null,
    web: core.getInput("web") || undefined,
    search: core.getInput("search") || undefined,
    write: core.getInput("write") || undefined,
    bash: core.getInput("bash") || undefined,
  });

  // convert "null" string to null, validate agent name
  const agent: AgentNameType | null =
    inputs.agent !== undefined && inputs.agent !== "null" && isAgentName(inputs.agent)
      ? inputs.agent
      : null;

  // try to parse prompt as JSON payload (internal invocation)
  let jsonPayload: typeof JsonPayload.infer | null = null;
  try {
    const parsed = JSON.parse(inputs.prompt);
    // if it looks like a pullfrog payload but fails validation, that's an error
    if (parsed && typeof parsed === "object" && "~pullfrog" in parsed) {
      jsonPayload = JsonPayload.assert(parsed);
    }
  } catch (error) {
    // JSON parse error is fine (plain text prompt), but validation error should propagate
    if (error instanceof type.errors) {
      throw new Error(`invalid pullfrog payload: ${error.summary}`);
    }
    // not JSON, treat as plain string prompt
  }

  // resolve event - use type guard for jsonPayload.event, fallback to unknown trigger
  const rawEvent = jsonPayload?.event;
  const event: PayloadEvent = isPayloadEvent(rawEvent) ? rawEvent : { trigger: "unknown" };

  // resolve agent from jsonPayload with type guard
  const jsonAgent = jsonPayload?.agent;
  const resolvedAgent: AgentNameType | null =
    agent ??
    (jsonAgent !== undefined && jsonAgent !== "null" && isAgentName(jsonAgent) ? jsonAgent : null);

  // build payload - precedence: inputs > jsonPayload > defaults
  // note: modes are NOT in payload - they come from repoSettings in main()
  return {
    "~pullfrog": true as const,
    agent: resolvedAgent,
    prompt: inputs.prompt ?? jsonPayload?.prompt,
    event,
    effort: inputs.effort ?? jsonPayload?.effort ?? "auto",
    web: inputs.web ?? jsonPayload?.web,
    search: inputs.search ?? jsonPayload?.search,
    write: inputs.write ?? jsonPayload?.write,
    bash: inputs.bash ?? jsonPayload?.bash,
    disableProgressComment: jsonPayload?.disableProgressComment === true,
    comment_id: jsonPayload?.comment_id ?? null,
    issue_id: jsonPayload?.issue_id ?? null,
    pr_id: jsonPayload?.pr_id ?? null,
    cwd: resolveCwd(inputs.cwd),
  };
}

export type ResolvedPayload = ReturnType<typeof resolvePayload>;
