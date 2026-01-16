import type { Agent } from "../agents/index.ts";

/**
 * Build a helpful error message for missing API key with links to repo settings
 */
function buildMissingApiKeyError(params: { agent: Agent; owner: string; name: string }): string {
  const apiUrl = process.env.API_URL || "https://pullfrog.com";
  const settingsUrl = `${apiUrl}/console/${params.owner}/${params.name}`;

  const githubRepoUrl = `https://github.com/${params.owner}/${params.name}`;
  const githubSecretsUrl = `${githubRepoUrl}/settings/secrets/actions`;

  let secretNameList: string;
  if (params.agent.apiKeyNames.length === 0) {
    secretNameList =
      "any API key (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)";
  } else {
    const secretNames = params.agent.apiKeyNames.map((key) => `\`${key}\``);
    secretNameList =
      params.agent.apiKeyNames.length === 1 ? secretNames[0] : `one of ${secretNames.join(" or ")}`;
  }

  return `Pullfrog is configured to use ${params.agent.displayName}, but the associated API key was not provided.

To fix this, add the required secret to your GitHub repository:

1. Go to: ${githubSecretsUrl}
2. Click "New repository secret"
3. Set the name to ${secretNameList}
4. Set the value to your API key
5. Click "Add secret"

Alternatively, configure Pullfrog to use a different agent at ${settingsUrl}`;
}

function collectApiKeys(agent: Agent): Record<string, string> {
  const apiKeys: Record<string, string> = {};

  // read API keys from environment variables
  for (const envKey of agent.apiKeyNames) {
    const value = process.env[envKey];
    if (value) {
      apiKeys[envKey] = value;
    }
  }

  // empty apiKeyNames means agent accepts any *API_KEY* env var
  if (agent.apiKeyNames.length === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && key.includes("API_KEY")) {
        apiKeys[key] = value;
      }
    }
  }

  return apiKeys;
}

export function validateApiKey(params: { agent: Agent; owner: string; name: string }): void {
  const apiKeys = collectApiKeys(params.agent);

  if (Object.keys(apiKeys).length === 0) {
    throw new Error(
      buildMissingApiKeyError({
        agent: params.agent,
        owner: params.owner,
        name: params.name,
      })
    );
  }
}
