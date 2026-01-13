#!/bin/bash

# Script to update pullfrog.yml workflow files across all repos in the pullfrog org
#
# Prerequisites:
# - GitHub CLI (gh) authenticated with org access
# - git configured
#
# Usage:
#   ./scripts/update-workflows.sh [--dry-run]

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "Running in DRY RUN mode"
fi

# Create the new workflow template
read -r -d '' NEW_WORKFLOW << 'EOF' || true
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
EOF

PR_BODY="This PR updates the \`pullfrog.yml\` workflow file to the new template format that uses environment variables for API keys.

## Changes
- Moved API keys from \`with:\` inputs to \`env:\` block
- Updated to use \`SCREAMING_CASE\` environment variable names
- Added \`secrets: inherit\` to \`workflow_call\` trigger
- Standardized job and step structure
- Added all supported API keys (feel free to comment out unused ones)

This change is required for compatibility with \`pullfrog/action@v0\` after the breaking changes introduced in https://github.com/pullfrog/action/pull/21

## Testing
The workflow should continue to work as before, but now reads API keys from environment variables instead of action inputs."

TMPDIR=$(mktemp -d)
BRANCH_NAME="pullfrog/update-workflow-template"

echo "Fetching repositories in pullfrog org..."
REPOS=$(gh repo list pullfrog --limit 100 --json name,nameWithOwner,defaultBranchRef)

TOTAL_REPOS=$(echo "$REPOS" | jq '. | length')
echo "Found $TOTAL_REPOS repositories"

UPDATED_COUNT=0

for row in $(echo "$REPOS" | jq -r '.[] | @base64'); do
  _jq() {
    echo "${row}" | base64 --decode | jq -r "${1}"
  }

  REPO_NAME=$(_jq '.name')
  REPO_FULL=$(_jq '.nameWithOwner')
  DEFAULT_BRANCH=$(_jq '.defaultBranchRef.name // "main"')

  echo ""
  echo "Checking $REPO_FULL..."

  # Check if repo has pullfrog.yml
  if ! gh api "repos/$REPO_FULL/contents/.github/workflows/pullfrog.yml" >/dev/null 2>&1; then
    echo "  ✗ No pullfrog.yml found"
    continue
  fi

  echo "  ✓ Found pullfrog.yml"
  UPDATED_COUNT=$((UPDATED_COUNT + 1))

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would update workflow in $REPO_FULL"
    continue
  fi

  REPO_DIR="$TMPDIR/$REPO_NAME"

  echo "  Cloning repository..."
  gh repo clone "$REPO_FULL" "$REPO_DIR" -- --quiet

  cd "$REPO_DIR"

  echo "  Creating branch $BRANCH_NAME..."
  git checkout -b "$BRANCH_NAME"

  echo "  Updating workflow file..."
  echo "$NEW_WORKFLOW" > .github/workflows/pullfrog.yml

  echo "  Committing changes..."
  git add .github/workflows/pullfrog.yml
  git commit -m "Update pullfrog.yml to new template with env-based API keys"

  echo "  Pushing branch..."
  git push origin "$BRANCH_NAME"

  echo "  Creating pull request..."
  PR_URL=$(gh pr create \
    --title "Update pullfrog.yml workflow template" \
    --body "$PR_BODY" \
    --base "$DEFAULT_BRANCH")

  echo "  ✓ Created PR: $PR_URL"

  cd -
done

echo ""
echo "========================================================"
echo "Summary:"
echo "  Total repos: $TOTAL_REPOS"
echo "  Repos with pullfrog.yml: $UPDATED_COUNT"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "To apply changes, run without --dry-run flag"
else
  echo ""
  echo "All PRs created successfully!"
fi

# Cleanup
rm -rf "$TMPDIR"
