/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */
const actionPath = process.env.GITHUB_ACTION_PATH || process.cwd();

export function createMcpConfig(githubToken: string, repoOwner: string, repoName: string) {
  return JSON.stringify(
    {
      mcpServers: {
        minimal_github_comment: {
          command: "node",
          args: [`${actionPath}/mcp/server.ts`],
          env: {
            GITHUB_TOKEN: githubToken,
            REPO_OWNER: repoOwner,
            REPO_NAME: repoName,
          },
        },
      },
    },
    null,
    2
  );
}
