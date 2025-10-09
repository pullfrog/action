/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */
const actionPath = process.env.GITHUB_ACTION_PATH || process.cwd();

export function createMcpConfig(githubInstallationToken: string) {
  return JSON.stringify(
    {
      mcpServers: {
        minimal_github_comment: {
          command: "node",
          args: [`${actionPath}/mcp/server.ts`],
          env: {
            GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
          },
        },
      },
    },
    null,
    2
  );
}
