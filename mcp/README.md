# gh_pullfrog MCP Tools

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
await mcp.call("gh_pullfrog/get_check_suite_logs", {
  check_suite_id: check_suite.id
});
```

### review tools

#### `get_review_comments`
get all line-by-line comments for a specific pull request review.

**parameters:**
- `pull_number` (number): the pull request number
- `review_id` (number): the id from review.id in the webhook payload

**replaces:** `gh api repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments`

**returns:**
array of review comments including:
- file path, line number, comment body
- side (LEFT/RIGHT) and position in diff
- user, timestamps, html_url
- in_reply_to_id for threaded comments

**example:**
```typescript
// when handling a pull_request_review_submitted webhook
await mcp.call("gh_pullfrog/get_review_comments", {
  pull_number: 47,
  review_id: review.id
});
```

#### `list_pull_request_reviews`
list all reviews for a pull request.

**parameters:**
- `pull_number` (number): the pull request number

**replaces:** `gh api repos/{owner}/{repo}/pulls/{pull_number}/reviews`

**returns:**
array of reviews with:
- review id, body, state (approved/changes_requested/commented)
- user, commit_id, submitted_at, html_url

**example:**
```typescript
await mcp.call("gh_pullfrog/list_pull_request_reviews", {
  pull_number: 47
});
```

#### `reply_to_review_comment`
reply to a PR review comment thread explaining how the feedback was addressed.

**parameters:**
- `pull_number` (number): the pull request number
- `comment_id` (number): the ID of the review comment to reply to
- `body` (string): the reply text explaining how the feedback was addressed

**replaces:** `gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`

**returns:**
the created reply comment including:
- comment id, body, html_url
- in_reply_to_id showing it's a reply to the specified comment

**example:**
```typescript
// after addressing a review comment
await mcp.call("gh_pullfrog/reply_to_review_comment", {
  pull_number: 47,
  comment_id: 2567334961,
  body: "removed the function as requested"
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

agents should prefer using the mcp tools provided by this server. the `gh` cli is available as a fallback if needed, but mcp tools handle authentication and provide better integration.

the agent instructions automatically include guidance on using these tools.

