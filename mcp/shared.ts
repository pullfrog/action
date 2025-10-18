import { cached } from "@ark/util";
import { Octokit } from "@octokit/rest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FastMCP, Tool } from "fastmcp";
import { parseRepoContext, type RepoContext } from "../utils/github.ts";

export const getMcpContext = cached((): McpContext => {
  const githubInstallationToken = process.env.GITHUB_INSTALLATION_TOKEN;
  if (!githubInstallationToken) {
    throw new Error("GITHUB_INSTALLATION_TOKEN environment variable is required");
  }

  return {
    ...parseRepoContext(),
    octokit: new Octokit({
      auth: githubInstallationToken,
    }),
  };
});

export interface McpContext extends RepoContext {
  octokit: Octokit;
}

export const tool = <const params>(tool: Tool<any, StandardSchemaV1<params>>) => tool;

export const addTools = (server: FastMCP, tools: Tool<any, any>[]) => {
  for (const tool of tools) {
    server.addTool(tool);
  }
  return server;
};
