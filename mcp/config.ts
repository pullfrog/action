/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */
const actionPath = process.env.GITHUB_ACTION_PATH || process.cwd();

// import { dirname } from "node:path";
// import { fileURLToPath } from "node:url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);
// const actionPath = dirname(__dirname);

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
