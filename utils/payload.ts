import { isAbsolute, resolve } from "node:path";
import * as core from "@actions/core";
import { type } from "arktype";
import {
  AgentName,
  type AgentName as AgentNameType,
  type AuthorPermission,
  Effort,
  type PayloadEvent,
} from "../external.ts";
import type { RepoSettings } from "./repoSettings.ts";

// tool permission enum types for inputs
const ToolPermissionInput = type.enumerated("disabled", "enabled");
const BashPermissionInput = type.enumerated("disabled", "restricted", "enabled");

// schema for JSON payload passed via prompt (internal dispatch invocation)
// note: permissions are intentionally NOT included here to prevent injection attacks
// permissions are derived from event.authorPermission instead
const JsonPayload = type({
  "~pullfrog": "true",
  "agent?": AgentName.or("null"),
  "prompt?": "string",
  "event?": "object",
  "effort?": Effort,
});

// permission levels that indicate collaborator status (have push access)
const COLLABORATOR_PERMISSIONS: AuthorPermission[] = ["admin", "maintain", "write"];

// check if the event author has collaborator-level permissions
function isCollaborator(event: PayloadEvent): boolean {
  const perm = event.authorPermission;
  return perm !== undefined && COLLABORATOR_PERMISSIONS.includes(perm);
}

// inputs schema - action inputs from core.getInput()
// note: tool permissions use .or("undefined") because getInput() || undefined
// explicitly sets the property to undefined when empty, which is different from
// the property being absent. arktype's "prop?" means "optional to include" but
// if included, must match the type - so we need to explicitly allow undefined.
export const Inputs = type({
  prompt: "string",
  "effort?": Effort,
  "agent?": AgentName.or("null"),
  "web?": ToolPermissionInput.or("undefined"),
  "search?": ToolPermissionInput.or("undefined"),
  "write?": ToolPermissionInput.or("undefined"),
  "bash?": BashPermissionInput.or("undefined"),
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

export function resolvePayload(repoSettings: RepoSettings) {
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

  // determine if permissions should be restricted based on event author
  // non-collaborators (read, triage, none, or missing) get restricted bash access
  const shouldRestrict = !isCollaborator(event);

  // build payload - precedence: inputs > repoSettings > fallbacks
  // note: modes are NOT in payload - they come from repoSettings in main()
  return {
    "~pullfrog": true as const,
    agent: resolvedAgent,
    // inverted: jsonPayload.prompt extracts the text from the JSON payload,
    // whereas inputs.prompt IS the raw JSON string when internally dispatched
    prompt: jsonPayload?.prompt ?? inputs.prompt,
    event,
    effort: inputs.effort ?? jsonPayload?.effort ?? "auto",
    cwd: resolveCwd(inputs.cwd),

    // permissions: inputs > repoSettings > fallbacks
    // bash is restricted for non-collaborators regardless of repoSettings
    web: inputs.web ?? repoSettings.web ?? "enabled",
    search: inputs.search ?? repoSettings.search ?? "enabled",
    write: inputs.write ?? repoSettings.write ?? "enabled",
    bash: inputs.bash ?? (shouldRestrict ? "restricted" : repoSettings.bash) ?? "restricted",
  };
}

export type ResolvedPayload = ReturnType<typeof resolvePayload>;
