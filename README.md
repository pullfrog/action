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

The `play.ts` script provides two ways to test the action:

### Local Mode (Default)
```bash
npm run play                        # Uses fixtures/play.txt
npm run play fixtures/complex.txt   # Custom prompt file
```
- Clones the scratch repository to `.temp`
- Runs Claude Code directly on your machine
- Fast iteration for development

### Docker Mode (--act flag)
```bash
npm run play -- --act                        # Uses fixtures/play.txt
npm run play fixtures/simple.txt -- --act    # Custom prompt file
```
- Builds fresh bundles with esbuild
- Creates minimal distribution without node_modules
- Runs in Docker container via `act`
- Simulates GitHub Actions environment

### Prompt Files

Supports `.txt`, `.json`, and `.ts` files:
```bash
npm run play prompt.txt           # Plain text prompt
npm run play config.json          # JSON configuration
npm run play dynamic.ts           # TypeScript with default export
```

## Building

```bash
pnpm build        # Production build (bundles & removes node_modules)
pnpm build:dev    # Development build (keeps node_modules)
pnpm dev          # Watch mode
```

The action is bundled into `entry.cjs` with all dependencies included, eliminating runtime dependency on node_modules.

## Environment Variables

Create `.env` in `/action`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # Claude API key
```

## Architecture

- **entry.cjs**: Bundled action entry point (self-contained)
- **agents/**: Agent implementations (Claude, etc.)
- **utils/**: Utilities for subprocess, act, and formatting
- **fixtures/**: Test prompt files

## Why No node_modules?

pnpm uses symlinks that cause "invalid symlink" errors when `act` copies the action to Docker. Our solution:
1. Bundle everything into `entry.cjs` 
2. Remove node_modules after building
3. Create minimal `.act-dist` for Docker testing