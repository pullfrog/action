/**
 * Secret detection and redaction utilities
 * Redacts actual secret values rather than using pattern matching
 */

import { agentsManifest } from "../external.ts";
import { getGitHubInstallationToken } from "./token.ts";

function getAllSecrets(): string[] {
  const secrets: string[] = [];

  // get all API key values from agent manifest
  for (const agent of Object.values(agentsManifest)) {
    for (const keyName of agent.apiKeyNames) {
      const envKey = keyName.toUpperCase();
      const value = process.env[envKey];
      if (value) {
        secrets.push(value);
      }
    }
  }

  // for OpenCode: also scan all API_KEY environment variables (since apiKeyNames is empty)
  const opencodeAgent = agentsManifest.opencode;
  if (opencodeAgent && opencodeAgent.apiKeyNames.length === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && key.includes("API_KEY")) {
        secrets.push(value);
      }
    }
  }

  // add GitHub installation token
  try {
    const token = getGitHubInstallationToken();
    if (token) {
      secrets.push(token);
    }
  } catch {
    // token not set yet, ignore
  }

  return secrets;
}

export function redactSecrets(content: string, secrets?: string[]): string {
  const secretsToRedact = [...(secrets ?? []), ...getAllSecrets()];
  let redacted = content;
  for (const secret of secretsToRedact) {
    if (secret) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      redacted = redacted.replaceAll(new RegExp(escaped, "g"), "[REDACTED_SECRET]");
    }
  }
  return redacted;
}

export function containsSecrets(content: string, secrets?: string[]): boolean {
  const secretsToCheck = secrets ?? getAllSecrets();
  return secretsToCheck.some((secret) => secret && content.includes(secret));
}
