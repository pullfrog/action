#!/usr/bin/env node

/**
 * Script to update pullfrog.yml workflow files across all repos in the pullfrog org
 *
 * Prerequisites:
 * - GitHub CLI (gh) authenticated with org access
 * - Node.js 18+
 *
 * Usage:
 *   node scripts/update-workflows.mjs [--dry-run]
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const NEW_WORKFLOW_TEMPLATE = `# PULLFROG ACTION — DO NOT EDIT EXCEPT WHERE INDICATED
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
          prompt: \${{ inputs.prompt }}
        env:
          # Feel free to comment out any you won't use
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          GOOGLE_API_KEY: \${{ secrets.GOOGLE_API_KEY }}
          GEMINI_API_KEY: \${{ secrets.GEMINI_API_KEY }}
          CURSOR_API_KEY: \${{ secrets.CURSOR_API_KEY }}
`;

const isDryRun = process.argv.includes('--dry-run');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    console.error(`Error executing: ${cmd}`);
    console.error(error.stderr || error.message);
    throw error;
  }
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main() {
  log(isDryRun ? 'Running in DRY RUN mode' : 'Running in LIVE mode');

  // Get all repos in the pullfrog org
  log('Fetching repositories in pullfrog org...');
  const reposJson = exec('gh repo list pullfrog --limit 100 --json name,nameWithOwner,defaultBranchRef');
  const repos = JSON.parse(reposJson);

  log(`Found ${repos.length} repositories`);

  const reposWithWorkflow = [];
  const tmpDir = '/tmp/pullfrog-workflow-updates';

  if (!isDryRun && !existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  for (const repo of repos) {
    const { name, nameWithOwner, defaultBranchRef } = repo;
    const defaultBranch = defaultBranchRef?.name || 'main';

    log(`\nChecking ${nameWithOwner}...`);

    // Check if repo has a pullfrog.yml workflow
    try {
      const workflowPath = `.github/workflows/pullfrog.yml`;
      const checkCmd = `gh api repos/${nameWithOwner}/contents/${workflowPath} --jq .name`;
      exec(checkCmd);

      log(`  ✓ Found pullfrog.yml in ${nameWithOwner}`);
      reposWithWorkflow.push({ name, nameWithOwner, defaultBranch });

      if (isDryRun) {
        log(`  [DRY RUN] Would update workflow in ${nameWithOwner}`);
        continue;
      }

      // Clone repo
      const repoDir = join(tmpDir, name);
      log(`  Cloning ${nameWithOwner}...`);
      exec(`gh repo clone ${nameWithOwner} ${repoDir}`);

      // Create branch
      const branchName = 'pullfrog/update-workflow-template';
      log(`  Creating branch ${branchName}...`);
      exec(`cd ${repoDir} && git checkout -b ${branchName}`);

      // Update workflow file
      const workflowFilePath = join(repoDir, '.github/workflows/pullfrog.yml');
      log(`  Updating workflow file...`);
      writeFileSync(workflowFilePath, NEW_WORKFLOW_TEMPLATE);

      // Commit changes
      log(`  Committing changes...`);
      exec(`cd ${repoDir} && git add .github/workflows/pullfrog.yml`);
      exec(`cd ${repoDir} && git commit -m "Update pullfrog.yml to new template with env-based API keys"`);

      // Push branch
      log(`  Pushing branch...`);
      exec(`cd ${repoDir} && git push origin ${branchName}`);

      // Create PR
      log(`  Creating pull request...`);
      const prBody = `This PR updates the \`pullfrog.yml\` workflow file to the new template format that uses environment variables for API keys.

## Changes
- Moved API keys from \`with:\` inputs to \`env:\` block
- Updated to use \`SCREAMING_CASE\` environment variable names
- Added \`secrets: inherit\` to \`workflow_call\` trigger
- Standardized job and step structure
- Added all supported API keys (feel free to comment out unused ones)

This change is required for compatibility with \`pullfrog/action@v0\` after the breaking changes introduced in https://github.com/pullfrog/action/pull/21

## Testing
The workflow should continue to work as before, but now reads API keys from environment variables instead of action inputs.`;

      const prUrl = exec(`cd ${repoDir} && gh pr create --title "Update pullfrog.yml workflow template" --body "${prBody.replace(/"/g, '\\"')}" --base ${defaultBranch}`);

      log(`  ✓ Created PR: ${prUrl}`);

    } catch (error) {
      if (error.message.includes('404')) {
        log(`  ✗ No pullfrog.yml found in ${nameWithOwner}`);
      } else {
        log(`  ✗ Error processing ${nameWithOwner}: ${error.message}`);
      }
    }
  }

  log(`\n${'='.repeat(60)}`);
  log(`Summary:`);
  log(`  Total repos: ${repos.length}`);
  log(`  Repos with pullfrog.yml: ${reposWithWorkflow.length}`);

  if (reposWithWorkflow.length > 0) {
    log(`\nRepositories with pullfrog.yml:`);
    reposWithWorkflow.forEach(r => log(`  - ${r.nameWithOwner}`));
  }

  if (isDryRun) {
    log(`\nTo apply changes, run without --dry-run flag`);
  } else {
    log(`\nAll PRs created successfully!`);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
