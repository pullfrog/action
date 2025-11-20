import { FastMCP } from "fastmcp";
import { ghPullfrogMcpName } from "../external.ts";
import { GetCheckSuiteLogsTool } from "./checkSuite.ts";
import {
  CreateCommentTool,
  CreateWorkingCommentTool,
  EditCommentTool,
  UpdateWorkingCommentTool,
} from "./comment.ts";
import { IssueTool } from "./issue.ts";
import { PullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { ReviewTool } from "./review.ts";
import { GetReviewCommentsTool, ListPullRequestReviewsTool } from "./reviewComments.ts";
import { SelectModeTool } from "./selectMode.ts";
import { addTools } from "./shared.ts";

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
  // ListFilesTool,
  PullRequestTool,
  ReviewTool,
  PullRequestInfoTool,
  GetReviewCommentsTool,
  ListPullRequestReviewsTool,
  GetCheckSuiteLogsTool,
]);

server.start();
