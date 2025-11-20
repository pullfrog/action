# gh-pullfrog MCP Tools

this directory contains the mcp (model context protocol) server tools for interacting with github.

## available tools

### check suite tools

#### `get_check_suite_logs`
get workflow run logs for a failed check suite.

**parameters:**
- `check_suite_id` (number): the id from check_suite.id in the webhook payload

**replaces:** `gh run list` and `gh run view --log`

**returns:**
all logs from all failed workflow runs in the check suite, including:
- workflow run details (id, name, html_url, conclusion)
- job details for each workflow run (id, name, status, conclusion, logs)

**example:**
```typescript
// when handling a check_suite_completed webhook
await mcp.call("gh-pullfrog/get_check_suite_logs", {
  check_suite_id: check_suite.id
});
```

### other tools

see individual files for documentation on other tools:
- `comment.ts` - create, edit, and update comments
- `issue.ts` - create issues
- `pr.ts` - create pull requests
- `prInfo.ts` - get pull request information
- `review.ts` - create pull request reviews
- `selectMode.ts` - select execution mode

## usage in agents

agents should never use the `gh` cli. instead, they should use the mcp tools provided by this server.

the agent instructions automatically include guidance on using these tools.

