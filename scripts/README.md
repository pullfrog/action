# Workflow Update Scripts

Scripts to update `pullfrog.yml` workflow files across all repositories in the pullfrog organization.

## Purpose

After the breaking changes in [PR #21](https://github.com/pullfrog/action/pull/21), all repositories using Pullfrog need their workflow files updated to use environment variables for API keys instead of action inputs.

## What These Scripts Do

1. List all repositories in the `pullfrog` organization
2. Identify repos with a `.github/workflows/pullfrog.yml` file
3. For each repo with the workflow file:
   - Create a new branch `pullfrog/update-workflow-template`
   - Update the workflow file to the new template
   - Commit and push the changes
   - Create a pull request

## Prerequisites

- **GitHub CLI (`gh`)** installed and authenticated
  ```bash
  gh auth login
  ```
- Authenticated account must have:
  - Read access to all pullfrog org repositories
  - Write access (push + PR creation) to repositories being updated
- For Node.js script: Node.js 18+
- For Bash script: `jq` command-line JSON processor

## Usage

### Option 1: Bash Script (Recommended)

```bash
# Dry run to see which repos would be updated
./scripts/update-workflows.sh --dry-run

# Actually create PRs
./scripts/update-workflows.sh
```

### Option 2: Node.js Script

```bash
# Dry run to see which repos would be updated
node scripts/update-workflows.mjs --dry-run

# Actually create PRs
node scripts/update-workflows.mjs
```

## New Workflow Template

The scripts update workflows to this template:

```yaml
# PULLFROG ACTION — DO NOT EDIT EXCEPT WHERE INDICATED
name: Pullfrog
on:
  workflow_dispatch:
    inputs:
      prompt:
        type: string
        description: Agent prompt
  workflow_call:
    inputs:
      prompt:
        description: Agent prompt
        type: string
    secrets: inherit

permissions:
  id-token: write

jobs:
  agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run agent
        uses: pullfrog/action@v0
        with:
          prompt: ${{ inputs.prompt }}
        env:
          # Feel free to comment out any you won't use
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
```

## Key Changes from Old Template

| Change | Before | After |
|--------|--------|-------|
| API key location | `with: anthropic_api_key:` | `env: ANTHROPIC_API_KEY:` |
| Key naming | `snake_case` | `SCREAMING_CASE` |
| Secrets inheritance | Not required | Add `secrets: inherit` to `workflow_call` |
| Prompt reference | `${{ github.event.inputs.prompt }}` | `${{ inputs.prompt }}` |

## Troubleshooting

### Permission denied errors
Ensure your GitHub CLI is authenticated with an account that has org access:
```bash
gh auth status
gh auth refresh -s repo,workflow
```

### Script fails on specific repo
Check if the repo has protected branches or special branch protection rules that prevent force pushing or creating PRs.

### Workflow already up to date
The script will still create a PR even if the content is the same. Review and close the PR if no changes are needed.

## Manual Execution

If you prefer to update repos individually or the scripts don't work in your environment, you can manually update each repo:

1. Clone the repo
   ```bash
   gh repo clone pullfrog/REPO_NAME
   cd REPO_NAME
   ```

2. Create a branch
   ```bash
   git checkout -b pullfrog/update-workflow-template
   ```

3. Update `.github/workflows/pullfrog.yml` with the new template

4. Commit and push
   ```bash
   git add .github/workflows/pullfrog.yml
   git commit -m "Update pullfrog.yml to new template with env-based API keys"
   git push origin pullfrog/update-workflow-template
   ```

5. Create PR
   ```bash
   gh pr create --title "Update pullfrog.yml workflow template" --body "Updates workflow to use env-based API keys per pullfrog/action#21"
   ```
