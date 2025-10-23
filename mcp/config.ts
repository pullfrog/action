/**
 * Simple MCP configuration helper for adding our minimal GitHub comment server
 */
import { fromHere } from "@ark/fs";
import { parseRepoContext } from "../utils/github.ts";

const actionPath = fromHere("..");

export const mcpServerName = "gh-pullfrog";

export function createMcpConfig(githubInstallationToken: string) {
  const repoContext = parseRepoContext();
  const githubRepository = `${repoContext.owner}/${repoContext.name}`;

  return JSON.stringify(
    {
      mcpServers: {
        [mcpServerName]: {
          command: "node",
          args: [`${actionPath}/mcp/server.ts`],
          env: {
            GITHUB_INSTALLATION_TOKEN: githubInstallationToken,
            GITHUB_REPOSITORY: githubRepository,
            LOG_LEVEL: process.env.LOG_LEVEL,
          },
        },
      },
    },
    null,
    2
  );
}
