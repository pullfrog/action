import { type Agent, agents } from "../agents/index.ts";
import type { AgentName } from "../external.ts";
import { log } from "./cli.ts";
import type { ResolvedPayload } from "./payload.ts";
import type { RepoSettings } from "./repoSettings.ts";

/**
 * Check if an agent has API keys available (from process.env)
 */
function agentHasApiKeys(agent: Agent): boolean {
  // empty apiKeyNames means agent accepts any *API_KEY* env var
  if (agent.apiKeyNames.length === 0) {
    return Object.keys(process.env).some((key) => key.includes("API_KEY") && process.env[key]);
  }
  return agent.apiKeyNames.some((envKey) => !!process.env[envKey]);
}

function getAvailableAgents(): Agent[] {
  return Object.values(agents).filter((agent) => agentHasApiKeys(agent));
}

export function resolveAgent(params: {
  payload: ResolvedPayload;
  repoSettings: RepoSettings;
}): Agent {
  const agentOverride = process.env.AGENT_OVERRIDE as AgentName | undefined;
  log.debug(
    `» determineAgent: agentOverride=${agentOverride}, payload.agent=${params.payload.agent}, repoSettings.defaultAgent=${params.repoSettings.defaultAgent}`
  );
  const configuredAgentName =
    agentOverride || params.payload.agent || params.repoSettings.defaultAgent || null;

  if (configuredAgentName) {
    const agent = agents[configuredAgentName];
    if (!agent) {
      throw new Error(`invalid agent name: ${configuredAgentName}`);
    }

    // if explicitly configured (via override or payload), respect it even without matching keys
    // this allows users to force an agent selection (will fail later with clear error if no keys)
    const isExplicitOverride = agentOverride !== undefined || params.payload.agent !== null;
    if (isExplicitOverride) {
      log.info(`» selected configured agent: ${agent.name}`);
      return agent;
    }

    // for repo-level defaults, check if agent has matching keys before selecting
    if (agentHasApiKeys(agent)) {
      log.info(`» selected configured agent: ${agent.name}`);
      return agent;
    }

    // fall through to auto-selection
    const availableAgents = getAvailableAgents();
    log.warning(
      `Repo default agent ${agent.name} has no matching API keys. Available: ${
        availableAgents.map((a) => a.name).join(", ") || "none"
      }`
    );
  }

  const availableAgents = getAvailableAgents();
  if (availableAgents.length === 0) {
    throw new Error("no agents available - missing API keys");
  }

  const agent = availableAgents[0];
  log.info(`» no agent configured, defaulting to first available agent: ${agent.name}`);
  return agent;
}
