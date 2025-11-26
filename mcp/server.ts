import "./arkConfig.ts";
// this must be imported first
import { createServer } from "node:net";
import { FastMCP } from "fastmcp";
import { ghPullfrogMcpName } from "../external.ts";
import { GetCheckSuiteLogsTool } from "./checkSuite.ts";
import {
  CreateCommentTool,
  CreateWorkingCommentTool,
  EditCommentTool,
  UpdateWorkingCommentTool,
} from "./comment.ts";
import { DebugShellCommandTool } from "./debug.ts";
import { IssueTool } from "./issue.ts";
import { PullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { ReviewTool } from "./review.ts";
import { GetReviewCommentsTool, ListPullRequestReviewsTool } from "./reviewComments.ts";
import { SelectModeTool } from "./selectMode.ts";
import { addTools } from "./shared.ts";

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const checkPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => {
        server.close();
        resolve(false);
      });
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
  };

  let port = startPort;
  while (port < startPort + 100) {
    if (await checkPort(port)) {
      return port;
    }
    port++;
  }
  throw new Error(`Could not find available port starting from ${startPort}`);
}

/**
 * Start the MCP HTTP server and return the URL and close function
 */
export async function startMcpHttpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = new FastMCP({
    name: ghPullfrogMcpName,
    version: "0.0.1",
  });

  addTools(server, [
    SelectModeTool,
    CreateCommentTool,
    EditCommentTool,
    CreateWorkingCommentTool,
    UpdateWorkingCommentTool,
    IssueTool,
    PullRequestTool,
    ReviewTool,
    PullRequestInfoTool,
    GetReviewCommentsTool,
    ListPullRequestReviewsTool,
    GetCheckSuiteLogsTool,
    DebugShellCommandTool,
  ]);

  const port = await findAvailablePort(3764);
  const host = "127.0.0.1";
  const endpoint = "/mcp";

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port,
      host,
      endpoint,
    },
  });

  const url = `http://${host}:${port}${endpoint}`;

  return {
    url,
    close: async () => {
      await server.stop();
    },
  };
}
