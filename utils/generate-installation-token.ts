import { createSign } from "node:crypto";
import { config } from "dotenv";

config();

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

const validateConfig = (config: GitHubAppConfig): void => {
  const { appId, privateKey, repoOwner, repoName } = config;

  if (!appId) {
    throw new Error("GITHUB_APP_ID environment variable is required");
  }

  if (!privateKey) {
    throw new Error("GITHUB_PRIVATE_KEY environment variable is required");
  }

  if (!repoOwner || !repoName) {
    throw new Error("REPO_OWNER and REPO_NAME environment variables are required");
  }

  if (!privateKey.includes("BEGIN") || !privateKey.includes("END")) {
    throw new Error("GITHUB_PRIVATE_KEY must be in PEM format");
  }
};

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

const checkRepositoryAccess = async (token: string, repoOwner: string, repoName: string): Promise<boolean> => {
  try {
    const response = await githubRequest<RepositoriesResponse>(
      "/installation/repositories",
      {
        headers: { Authorization: `token ${token}` },
      }
    );

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

const findInstallationId = async (jwt: string, repoOwner: string, repoName: string): Promise<number> => {
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
    } catch {
      // Installation doesn't have access to repository
    }
  }

  throw new Error(
    `No installation found with access to ${repoOwner}/${repoName}. ` +
      "Ensure the GitHub App is installed on the target repository."
  );
};

export const generateInstallationToken = async (
  repoOwner?: string,
  repoName?: string
): Promise<string> => {
  const config: GitHubAppConfig = {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n")!,
    repoOwner: repoOwner || process.env.REPO_OWNER || "pullfrogai",
    repoName: repoName || process.env.REPO_NAME || "scratch",
  };

  validateConfig(config);

  const jwt = generateJWT(config.appId, config.privateKey);
  const installationId = await findInstallationId(jwt, config.repoOwner, config.repoName);
  const token = await createInstallationToken(jwt, installationId);

  return token;
};
