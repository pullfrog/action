import * as core from "@actions/core";

/**
 * Setup GitHub installation token for the action
 */
export async function setupGitHubInstallationToken(): Promise<string> {
  // Check if we have an installation token from inputs or environment
  const inputToken = core.getInput("github_installation_token");
  const envToken = process.env.GITHUB_INSTALLATION_TOKEN;
  
  const existingToken = inputToken || envToken;
  if (existingToken) {
    core.info("Using provided GitHub installation token");
    return existingToken;
  }

  core.info("No cached installation token found, generating OIDC token...");

  try {
    // Generate OIDC token for our API
    const oidcToken = await core.getIDToken("pullfrog-api");
    core.info("OIDC token generated successfully");

    // Exchange OIDC token for installation token
    const apiUrl = process.env.API_URL || "https://pullfrog.ai";

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

    const tokenData = await tokenResponse.json();
    core.info(
      `Installation token obtained for ${tokenData.owner}/${tokenData.repository || "all repositories"}`
    );

    // Set the token as an environment variable for this run
    process.env.GITHUB_INSTALLATION_TOKEN = tokenData.token;

    return tokenData.token;
  } catch (error) {
    throw new Error(
      `Failed to setup GitHub installation token: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
