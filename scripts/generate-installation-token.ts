#!/usr/bin/env tsx

/**
 * GitHub App Installation Token Generator
 *
 * Generates a temporary installation token for a GitHub App to access a specific repository.
 * Uses environment variables for configuration and supports multiple installations.
 *
 * Usage:
 *   node scripts/generate-installation-token.ts [--repo owner/name] [--update-env]
 *
 * Environment variables required:
 *   GITHUB_APP_ID - GitHub App ID
 *   GITHUB_PRIVATE_KEY - GitHub App private key (PEM format)
 *   REPO_OWNER - Target repository owner (default)
 *   REPO_NAME - Target repository name (default)
 */

import { createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

// Load environment variables
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

class GitHubAppTokenGenerator {
  private config: GitHubAppConfig;

  constructor(config: GitHubAppConfig) {
    // Process private key to handle escaped newlines
    config.privateKey = config.privateKey.replace(/\\n/g, "\n");
    this.config = config;
    this.validateConfig();
  }

  private validateConfig(): void {
    const { appId, privateKey, repoOwner, repoName } = this.config;

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
  }

  /**
   * Generates a JWT for GitHub App authentication
   */
  private generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // issued 1 minute ago to account for clock skew
      exp: now + 5 * 60, // expires in 5 minutes
      iss: this.config.appId,
    };

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signaturePart = `${encodedHeader}.${encodedPayload}`;

    const signature = createSign("RSA-SHA256")
      .update(signaturePart)
      .sign(this.config.privateKey, "base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    return `${signaturePart}.${signature}`;
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Makes authenticated requests to GitHub API
   */
  private async githubRequest<T>(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<T> {
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
  }

  /**
   * Finds the installation ID for the target repository
   */
  private async findInstallationId(jwt: string): Promise<number> {
    console.log("🔍 Finding GitHub App installation...");

    const installations = await this.githubRequest<Installation[]>("/app/installations", {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    console.log(`📋 Found ${installations.length} installation(s)`);

    // Check each installation for access to target repository
    for (const installation of installations) {
      console.log(`🔎 Checking installation ${installation.id} (${installation.account.login})`);

      try {
        // Create a temporary token to check repository access
        const tempToken = await this.createInstallationToken(jwt, installation.id);
        const hasAccess = await this.checkRepositoryAccess(tempToken);

        if (hasAccess) {
          console.log(
            `✅ Installation ${installation.id} has access to ${this.config.repoOwner}/${this.config.repoName}`
          );
          return installation.id;
        }
      } catch (error) {
        console.log(
          `❌ Installation ${installation.id} check failed:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new Error(
      `No installation found with access to ${this.config.repoOwner}/${this.config.repoName}. ` +
        "Ensure the GitHub App is installed on the target repository."
    );
  }

  /**
   * Checks if the installation token has access to the target repository
   */
  private async checkRepositoryAccess(token: string): Promise<boolean> {
    try {
      const response = await this.githubRequest<RepositoriesResponse>(
        "/installation/repositories",
        {
          headers: { Authorization: `token ${token}` },
        }
      );

      return response.repositories.some(
        (repo) => repo.owner.login === this.config.repoOwner && repo.name === this.config.repoName
      );
    } catch {
      return false;
    }
  }

  /**
   * Creates an installation access token
   */
  private async createInstallationToken(jwt: string, installationId: number): Promise<string> {
    const response = await this.githubRequest<InstallationTokenResponse>(
      `/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }
    );

    return response.token;
  }

  /**
   * Generates a new installation token for the configured repository
   */
  async generateToken(): Promise<{
    token: string;
    installationId: number;
    expiresAt: string;
  }> {
    console.log(
      `🚀 Generating installation token for ${this.config.repoOwner}/${this.config.repoName}`
    );
    console.log(`📱 App ID: ${this.config.appId}`);

    // Step 1: Generate JWT for app authentication
    const jwt = this.generateJWT();
    console.log("🔐 Generated JWT token");

    // Step 2: Find installation with repository access
    const installationId = await this.findInstallationId(jwt);

    // Step 3: Create installation access token
    console.log(`🎫 Creating installation token for installation ${installationId}...`);
    const token = await this.createInstallationToken(jwt, installationId);

    // Calculate expiration (GitHub tokens expire after 1 hour)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    console.log("✅ Installation token generated successfully!");
    console.log(`🎟️  Token: ${token.substring(0, 20)}...`);
    console.log(`📅 Expires: ${expiresAt}`);
    console.log(`🏢 Installation ID: ${installationId}`);

    return { token, installationId, expiresAt };
  }

  /**
   * Updates the .env file with the new installation token
   */
  updateEnvFile(token: string): void {
    const envPath = join(process.cwd(), ".env");

    try {
      let envContent = readFileSync(envPath, "utf8");

      // Update or add the installation token
      const tokenLine = `GITHUB_INSTALLATION_TOKEN=${token}`;
      const tokenRegex = /^GITHUB_INSTALLATION_TOKEN=.*$/m;

      if (tokenRegex.test(envContent)) {
        envContent = envContent.replace(tokenRegex, tokenLine);
      } else {
        envContent += `\n${tokenLine}\n`;
      }

      writeFileSync(envPath, envContent);
      console.log(`📝 Updated ${envPath} with new installation token`);
    } catch (error) {
      console.error(
        "❌ Failed to update .env file:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

/**
 * CLI interface
 */
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const updateEnv = args.includes("--update-env");

    // Parse repository from args if provided
    const repoArg = args.find((arg) => arg.startsWith("--repo="));
    let repoOwner = process.env.REPO_OWNER || "pullfrogai";
    let repoName = process.env.REPO_NAME || "scratch";

    if (repoArg) {
      const [owner, name] = repoArg.split("=")[1].split("/");
      if (owner && name) {
        repoOwner = owner;
        repoName = name;
      } else {
        throw new Error("Invalid --repo format. Use: --repo=owner/name");
      }
    }

    const config: GitHubAppConfig = {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!,
      repoOwner,
      repoName,
    };

    const generator = new GitHubAppTokenGenerator(config);
    const result = await generator.generateToken();

    if (updateEnv) {
      generator.updateEnvFile(result.token);
    }

    console.log("\n🎉 Token generation complete!");

    if (!updateEnv) {
      console.log("\n💡 To automatically update your .env file, run with --update-env flag");
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubAppTokenGenerator };
