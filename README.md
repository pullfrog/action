<p align="center">
  
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://pullfrog.com/frog-white-200px.png">
      <img src="https://pullfrog.com/frog-green-200px.png" width="25px" align="center" alt="Pullfrog logo" />
    </picture><br />
    Pullfrog
  </h1>
  <p align="center">
    Bring your favorite coding agent into GitHub
  </p>
</p>

<br/>

## What is Pullfrog?

Pullfrog is a GitHub bot that brings the full power of your favorite coding agents into GitHub. It's open source and powered by GitHub Actions. 

<a href="https://github.com/apps/pullfrog/installations/new">
  <img src="https://pullfrog.com/add-to-github.png" alt="Add to GitHub" width="150px" />
</a>

<br />

Once added, you can start triggering agent runs.

- **Tag `@pullfrog`** — Tag `@pullfrog` in a comment anywhere in your repo. It will pull in any relevant context using the action's internal MCP server and perform the appropriate task.
- **Prompt from the web** — Trigger arbitrary tasks from the Pullfrog dashboard
- **Automated triggers** — Configure Pullfrog to trigger agent runs in response to specific events. Each of these triggers can be associated with custom prompt instructions. 
  - issue created
  - issue labeled
  - PR created
  - PR review created 
  - PR review requested
  - and more...

Pullfrog is the bridge between GitHub and your preferred coding agents and GitHub. Use it for:
 
- **🤖 Coding tasks** — Tell `@pullfrog` to implement something and it'll spin up a PR. If CI fails, it'll read the logs and attempt a fix automatically. It'll automatically address any PR reviews too.
- **🔍 PR review** — Coding agents are great at reviewing PRs. Using the "PR created" trigger, you can configure Pullfrog to auto-review new PRs.
- **🤙 Issue management** — Via the "issue created" trigger, Pullfrog can automatically respond to common questions, create implementation plans, and link to related issues/PRs. Or (if you're feeling lucky) you can prompt it to immediately attempt a PR addressing new issues.
- **Literally whatever** — Want to have the agent automatically add docs to all new PRs? Cut a new release with agent-written notes on every commit to `main`? Pullfrog lets you do it.

<!-- Features
- **Agent-agnostic** — Switch between agents with the click of a radio button.
- ** -->

## Get started

Install the Pullfrog GitHub App on your personal or organization account. During installation you can choose to limit access to a specific repo or repos. After installation, you'll be redirected to the Pullfrog dashboard where you'll see an onboarding flow. This flow will create your `pullfrog.yml` workflow and prompt you to set up API keys. Once you finish those steps (2 minutes) you're ready to rock.

[Add to GitHub ➜](https://github.com/apps/pullfrog/installations/new)

<details>
<summary><strong>Manual setup instructions</strong></summary>

You can also use the `pullfrog/action` Action without a GitHub App installation. This is more time-consuming to set up, and it places limitations on the actions your Agent will be capable of performing.

To manually set up the Pullfrog action, you need to set up two workflow files in your repository: `pullfrog.yml` (the execution logic) and `triggers.yml` (the event triggers).

#### 1. Create `pullfrog.yml`

Create a file at `.github/workflows/pullfrog.yml`. This is a reusable workflow that runs the Pullfrog action.

```yaml
# PULLFROG ACTION — DO NOT EDIT EXCEPT WHERE INDICATED
name: Pullfrog
on:
  workflow_dispatch:
    inputs:
      prompt:
        type: string
        description: 'Agent prompt'
  workflow_call:
    inputs:
      prompt:
        description: 'Agent prompt'
        type: string

permissions:
  id-token: write
  contents: read

jobs:
  pullfrog:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      # optionally, setup your repo here
      # the agent can figure this out itself, but pre-setup is more efficient
      # - uses: actions/setup-node@v6
      
      - name: Run agent
        uses: pullfrog/action@v0
        with:
          prompt: ${{ github.event.inputs.prompt }}

          # feel free to comment out any you won't use
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          google_api_key: ${{ secrets.GOOGLE_API_KEY }}
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          cursor_api_key: ${{ secrets.CURSOR_API_KEY }}
          
```

#### 2. Create `triggers.yml`

Create a file at `.github/workflows/triggers.yml`. This workflow listens for GitHub events and calls the `pullfrog.yml` workflow with the event data.

```yaml
name: Agent Triggers

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]
  # add other triggers as needed
  

jobs:
  pullfrog:
    
    # trigger conditions (e.g. only run if @pullfrog is mentioned)
    if: contains(github.event.comment.body, '@pullfrog') || contains(github.event.issue.body, '@pullfrog')
    
    permissions:
      id-token: write
      contents: write
      issues: write
      pull-requests: write
      actions: read
      checks: read
    uses: ./.github/workflows/pullfrog.yml
    with:
      # pass the full event payload as the prompt
      prompt: ${{ toJSON(github.event) }}
    secrets: inherit
```

</details>
