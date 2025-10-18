import { createSign } from "node:crypto";
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

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  repoOwner: string;
  repoName: string;
}

interface Installation {
  id: number;
  account: {
    login: string;
    type: string;
  };
}

interface Repository {
  owner: {
    login: string;
  };
  name: string;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

interface RepositoriesResponse {
  repositories: Repository[];
}

function checkExistingToken(): string | null {
  const inputToken = core.getInput("github_installation_token");
  const envToken = process.env.GITHUB_INSTALLATION_TOKEN;
  return inputToken || envToken || null;
}

function isGitHubActionsEnvironment(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS);
}

async function acquireTokenViaOIDC(): Promise<string> {
  core.info("Generating OIDC token...");

  const oidcToken = await core.getIDToken("pullfrog-api");
  core.info("OIDC token generated successfully");

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

  const tokenData = (await tokenResponse.json()) as InstallationToken;
  core.info(`Installation token obtained for ${tokenData.repository || "all repositories"}`);

  return tokenData.token;
}

const base64UrlEncode = (str: string): string => {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

const generateJWT = (appId: string, privateKey: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 5 * 60,
    iss: appId,
  };

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = `${encodedHeader}.${encodedPayload}`;

  const signature = createSign("RSA-SHA256")
    .update(signaturePart)
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${signaturePart}.${signature}`;
};

const githubRequest = async <T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<T> => {
  const { method = "GET", headers = {}, body } = options;

  const url = `https://api.github.com${path}`;
  const requestHeaders = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Pullfrog-Installation-Token-Generator/1.0",
    ...headers,
  };

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    ...(body && { body }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as T;
};

const checkRepositoryAccess = async (
  token: string,
  repoOwner: string,
  repoName: string
): Promise<boolean> => {
  try {
    const response = await githubRequest<RepositoriesResponse>("/installation/repositories", {
      headers: { Authorization: `token ${token}` },
    });

    return response.repositories.some(
      (repo) => repo.owner.login === repoOwner && repo.name === repoName
    );
  } catch {
    return false;
  }
};

const createInstallationToken = async (jwt: string, installationId: number): Promise<string> => {
  const response = await githubRequest<InstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    }
  );

  return response.token;
};

const findInstallationId = async (
  jwt: string,
  repoOwner: string,
  repoName: string
): Promise<number> => {
  const installations = await githubRequest<Installation[]>("/app/installations", {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  for (const installation of installations) {
    try {
      const tempToken = await createInstallationToken(jwt, installation.id);
      const hasAccess = await checkRepositoryAccess(tempToken, repoOwner, repoName);

      if (hasAccess) {
        return installation.id;
      }
    } catch {}
  }

  throw new Error(
    `No installation found with access to ${repoOwner}/${repoName}. ` +
      "Ensure the GitHub App is installed on the target repository."
  );
};

async function acquireTokenViaGitHubApp(): Promise<string> {
  const repoContext = parseRepoContext();

  const config: GitHubAppConfig = {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n")!,
    repoOwner: repoContext.owner,
    repoName: repoContext.name,
  };

  const jwt = generateJWT(config.appId, config.privateKey);
  const installationId = await findInstallationId(jwt, config.repoOwner, config.repoName);
  const token = await createInstallationToken(jwt, installationId);

  return token;
}

async function acquireNewToken(): Promise<string> {
  if (isGitHubActionsEnvironment()) {
    return await acquireTokenViaOIDC();
  } else {
    return await acquireTokenViaGitHubApp();
  }
}

/**
 * Setup GitHub installation token for the action
 */
export async function setupGitHubInstallationToken(): Promise<string> {
  const existingToken = checkExistingToken();
  if (existingToken) {
    core.setSecret(existingToken);
    core.info("Using provided GitHub installation token");
    return existingToken;
  }

  const token = await acquireNewToken();

  core.setSecret(token);
  process.env.GITHUB_INSTALLATION_TOKEN = token;

  return token;
}

export interface RepoContext {
  owner: string;
  name: string;
}

/**
 * Parse repository context from GITHUB_REPOSITORY environment variable.
 */
export function parseRepoContext(): RepoContext {
  const githubRepo = process.env.GITHUB_REPOSITORY;
  if (!githubRepo) {
    throw new Error("GITHUB_REPOSITORY environment variable is required");
  }

  const [owner, name] = githubRepo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${githubRepo}. Expected 'owner/repo'`);
  }

  return { owner, name };
}
