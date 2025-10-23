import { mcpServerName } from "../mcp/config.ts";

export const instructions = `- use the ${mcpServerName} MCP server to interact with github
- if ${mcpServerName} is not available or doesn't include the functionality you need, describe why and bail
- do not under any circumstances use the gh cli
- if prompted by a comment to respond to create a new issue, pr or anything else, after succeeding,
    also respond to the original comment with a very brief message containing a link to it
`;
