import * as core from "@actions/core";

export interface InstallationToken {
  token: string;
  expires_at: string;
  installation_id: number;
  repository: string;
  ref: string;
  runner_environment: string;
  owner?: string;
}

/**
 * Setup GitHub installation token for the action
 */
export async function setupGitHubInstallationToken(): Promise<string> {
  // Check if we have an installation token from inputs or environment
  const inputToken = core.getInput("github_installation_token");
  const envToken = process.env.GITHUB_INSTALLATION_TOKEN;

  const existingToken = inputToken || envToken;
  if (existingToken) {
    // Mask the existing token in logs for security
    core.setSecret(existingToken);
    core.info("Using provided GitHub installation token");
    return existingToken;
  }

  core.info("Generating OIDC token...");

  try {
    // Generate OIDC token for our API
    const oidcToken = await core.getIDToken("pullfrog-api");
    core.info("OIDC token generated successfully");

    // Exchange OIDC token for installation token
    const apiUrl = process.env.API_URL || "https://pullfrog.ai";

    core.info("Exchanging OIDC token for installation token...");
    const tokenResponse = await fetch(`${apiUrl}/api/github/installation-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(
        `Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`
      );
    }

    // This type is enforced by us when the response is created
    const tokenData = (await tokenResponse.json()) as InstallationToken;
    core.info(`Installation token obtained for ${tokenData.repository || "all repositories"}`);

    // Mask the token in logs for security
    core.setSecret(tokenData.token);

    // Set the token as an environment variable for this run
    process.env.GITHUB_INSTALLATION_TOKEN = tokenData.token;

    return tokenData.token;
  } catch (error) {
    throw new Error(
      `Failed to setup GitHub installation token: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
