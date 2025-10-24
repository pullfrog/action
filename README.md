# Pullfrog Action

GitHub Action for running Claude Code and other agents via Pullfrog.

> **📖 Claude Code Action Architecture**: For a detailed technical overview of how the Claude Code Action works (token exchange, modes, data fetching, execution flow), see [CLAUDE-ACTION.md](./CLAUDE-ACTION.md).

## Quick Start

```bash
# Install dependencies
pnpm install

# Test with default prompt
npm run play              # Run locally on your machine
npm run play -- --act     # Run in Docker (simulates GitHub Actions)
```

## Testing with play.ts

```bash
pnpm play                        # Uses fixtures/play.txt
```
- Clones the scratch repository to `.temp`
- Runs Claude Code directly on your machine
- Fast iteration for development
