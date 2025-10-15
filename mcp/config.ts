/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */
import { fromHere } from "@ark/fs";

const actionPath = fromHere("..");

export function createMcpConfig(githubInstallationToken: string) {
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) {
    throw new Error(
      "GITHUB_REPOSITORY environment variable is required for MCP GitHub integration"
    );
  }

  return JSON.stringify(
    {
      mcpServers: {
        minimal_github_comment: {
          command: "node",
          args: [`${actionPath}/mcp/server.ts`],
          env: {
            GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
            GITHUB_REPOSITORY: githubRepository,
            LOG_LEVEL: "debug",
          },
        },
      },
    },
    null,
    2
  );
}
