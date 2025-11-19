import { flatMorph } from "@ark/util";
import { type } from "arktype";
import { agents } from "./agents/index.ts";
import { createMcpConfigs } from "./mcp/config.ts";
import { modes } from "./modes.ts";
import packageJson from "./package.json" with { type: "json" };
import type { Payload } from "./payload.ts";
import { fetchRepoSettings } from "./utils/api.ts";
import { log } from "./utils/cli.ts";
import {
  parseRepoContext,
  type RepoContext,
  revokeInstallationToken,
  setupGitHubInstallationToken,
} from "./utils/github.ts";
import { setupGitAuth, setupGitConfig } from "./utils/setup.ts";

export const AgentName = type.enumerated(...Object.values(agents).map((agent) => agent.name));
export type AgentName = typeof AgentName.infer;

export const AgentInputKey = type.enumerated(
  ...Object.values(agents).flatMap((agent) => agent.inputKeys)
);
export type AgentInputKey = typeof AgentInputKey.infer;

const keyInputDefs = flatMorph(agents, (_, agent) =>
  agent.inputKeys.map((inputKey) => [inputKey, "string | undefined?"] as const)
);

export const Inputs = type({
  prompt: "string",
  ...keyInputDefs,
  "agent?": AgentName.or("undefined"),
});

export type Inputs = typeof Inputs.infer;

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

/**
 * Throw an error for missing API key with helpful message linking to repo settings
 */
function throwMissingApiKeyError({
  agentName,
  inputKeys,
  repoContext,
  inputs,
}: {
  agentName: string;
  inputKeys: string[];
  repoContext: RepoContext;
  inputs: Inputs;
}): never {
  const apiUrl = process.env.API_URL || "https://pullfrog.ai";
  const settingsUrl = `${apiUrl}/console/${repoContext.owner}/${repoContext.name}`;

  const secretNames = inputKeys.map((key) => `\`${key.toUpperCase()}\``);
  const secretNameList =
    inputKeys.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;

  const githubRepoUrl = `https://github.com/${repoContext.owner}/${repoContext.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  // Find which agents have inputKeys that match the provided inputs
  const availableAgents = Object.values(agents).filter((agent) =>
    agent.inputKeys.some((inputKey) => inputs[inputKey])
  );

  let message = `Pullfrog is configured to use ${agentName}, but the associated API key was not provided.

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"`;

  // If other credentials are present, suggest alternative agents
  if (availableAgents.length > 0) {
    const agentNames = availableAgents.map((agent) => agent.name).join(", ");
    message += `\n\nAlternatively, configure Pullfrog to use an agent with existing credentials in your environment (${agentNames}) at ${settingsUrl}`;
  }

  log.error(message);
  throw new Error(message);
}

export async function main(inputs: Inputs): Promise<MainResult> {
  let tokenToRevoke: string | null = null;

  try {
    log.info(`🐸 Running pullfrog/action@${packageJson.version}...`);

    Inputs.assert(inputs);
    setupGitConfig();

    const { githubInstallationToken, wasAcquired } = await setupGitHubInstallationToken();
    if (wasAcquired) {
      tokenToRevoke = githubInstallationToken;
    }
    const repoContext = parseRepoContext();

    const repoSettings = await fetchRepoSettings({
      token: githubInstallationToken,
      repoContext,
    });

    const agentName: AgentName = inputs.agent || repoSettings.defaultAgent || "claude";

    const agent = agents[agentName];

    setupGitAuth(githubInstallationToken, repoContext);

    const mcpServers = createMcpConfigs(githubInstallationToken);

    log.debug(`📋 MCP Config: ${JSON.stringify(mcpServers, null, 2)}`);

    // Install agent CLI before running
    const cliPath = await agent.install();

    log.info(`Running ${agentName}...`);

    let payload: Payload;

    try {
      // attempt JSON parsing
      const parsedPrompt = JSON.parse(inputs.prompt);
      if (!("~pullfrog" in parsedPrompt)) {
        throw new Error("Invalid prompt: not a pullfrog webhook payload");
      }
      payload = parsedPrompt as Payload;
    } catch {
      payload = {
        "~pullfrog": true,
        agent: null,
        prompt: inputs.prompt,
        event: {},
        modes,
      };
    }

    log.box(payload.prompt, { title: "Prompt" });

    const matchingInputKey = agent.inputKeys.find((inputKey) => inputs[inputKey]);

    if (!matchingInputKey) {
      throwMissingApiKeyError({
        agentName,
        inputKeys: agent.inputKeys,
        repoContext,
        inputs,
      });
    }

    const apiKey = inputs[matchingInputKey]!;

    const result = await agent.run({
      payload,
      mcpServers,
      githubInstallationToken,
      apiKey,
      cliPath,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Agent execution failed",
        output: result.output!,
      };
    }

    log.success("Task complete.");
    await log.writeSummary();

    return {
      success: true,
      output: result.output || "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    log.error(errorMessage);
    await log.writeSummary();
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (tokenToRevoke) {
      await revokeInstallationToken(tokenToRevoke);
    }
  }
}
