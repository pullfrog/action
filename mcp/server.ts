import "./arkConfig.ts";
import { createServer } from "node:net";
// this must be imported first
import { FastMCP, type Tool } from "fastmcp";
import { ghPullfrogMcpName } from "../external.ts";
import type { ToolContext } from "../main.ts";
import { CheckoutPrTool } from "./checkout.ts";
import { GetCheckSuiteLogsTool } from "./checkSuite.ts";
import {
  CreateCommentTool,
  EditCommentTool,
  ReplyToReviewCommentTool,
  ReportProgressTool,
} from "./comment.ts";
import { DebugShellCommandTool } from "./debug.ts";
import {
  AwaitDependencyInstallationTool,
  StartDependencyInstallationTool,
} from "./dependencies.ts";
import { ListFilesTool } from "./files.ts";
import { CommitFilesTool, CreateBranchTool, PushBranchTool } from "./git.ts";
import { IssueTool } from "./issue.ts";
import { GetIssueCommentsTool } from "./issueComments.ts";
import { GetIssueEventsTool } from "./issueEvents.ts";
import { IssueInfoTool } from "./issueInfo.ts";
import { AddLabelsTool } from "./labels.ts";
import { PullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { CreatePullRequestReviewTool } from "./review.ts";
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
export async function startMcpHttpServer(
  ctx: ToolContext
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = new FastMCP({
    name: ghPullfrogMcpName,
    version: "0.0.1",
  });

  // create all tools as factories, passing ctx
  const tools: Tool<any, any>[] = [
    SelectModeTool(ctx),
    StartDependencyInstallationTool(ctx),
    AwaitDependencyInstallationTool(ctx),
    CreateCommentTool(ctx),
    EditCommentTool(ctx),
    ReplyToReviewCommentTool(ctx),
    IssueTool(ctx),
    IssueInfoTool(ctx),
    GetIssueCommentsTool(ctx),
    GetIssueEventsTool(ctx),
    PullRequestTool(ctx),
    CreatePullRequestReviewTool(ctx),
    PullRequestInfoTool(ctx),
    CheckoutPrTool(ctx),
    GetReviewCommentsTool(ctx),
    ListPullRequestReviewsTool(ctx),
    GetCheckSuiteLogsTool(ctx),
    DebugShellCommandTool(ctx),
    AddLabelsTool(ctx),
    CreateBranchTool(ctx),
    CommitFilesTool(ctx),
    PushBranchTool(ctx),
    ListFilesTool(ctx),
  ];

  if (!ctx.payload.disableProgressComment) {
    tools.push(ReportProgressTool(ctx));
  }

  addTools(ctx, server, tools);

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
