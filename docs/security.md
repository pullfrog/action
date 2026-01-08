# Bash Tool Security

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions Runner                                          │
│  (has secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)        │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Pullfrog Action (Node.js)                                │ │
│  │  - process.env contains all secrets                       │ │
│  │  - spawns agent CLI as child process                      │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │  Agent CLI (Claude/Cursor/OpenCode/etc.)            │ │ │
│  │  │  - receives filtered env (only API key it needs)    │ │ │
│  │  │  - has built-in Bash tool (DISABLED)                │ │ │
│  │  │  - connects to MCP server for tools                 │ │ │
│  │  │                                                     │ │ │
│  │  │  ┌───────────────────────────────────────────────┐ │ │ │
│  │  │  │  MCP Bash Tool (our code)                     │ │ │ │
│  │  │  │  - agent calls this for shell commands        │ │ │ │
│  │  │  │  - spawns bash with filtered env              │ │ │ │
│  │  │  │  - uses PID namespace isolation               │ │ │ │
│  │  │  │                                               │ │ │ │
│  │  │  │  ┌─────────────────────────────────────────┐ │ │ │ │
│  │  │  │  │  Bash subprocess                        │ │ │ │ │
│  │  │  │  │  - runs user-controlled commands        │ │ │ │ │
│  │  │  │  │  - MUST NOT access secrets              │ │ │ │ │
│  │  │  │  └─────────────────────────────────────────┘ │ │ │ │
│  │  │  └───────────────────────────────────────────────┘ │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight**: The Pullfrog Action process has all secrets in `process.env`. Agent CLIs have built-in Bash tools that we can't trust. We disable those and provide our own MCP Bash tool that spawns subprocesses securely.

---

## Threat Model

A prompt-injected agent could run malicious bash commands to exfiltrate API keys.

**Attack vectors:**

| Vector | Example | Mitigation |
|--------|---------|------------|
| Direct env access | `env \| grep KEY` | Filter env vars before spawn |
| Echo variable | `echo $ANTHROPIC_API_KEY` | Filter env vars before spawn |
| `/proc/$PPID/environ` | `cat /proc/$PPID/environ` | PID namespace isolation |

The first two are solved by passing filtered env to subprocess. The third requires special handling on Linux.

---

## Attack: /proc/$PPID/environ

On Linux, any process can read its parent's environment via `/proc/$PPID/environ`. Even if we spawn bash with a clean environment, the bash process can:

```bash
# read parent's (Node.js) environment - contains all secrets!
tr '\0' '\n' < /proc/$PPID/environ | grep KEY
```

This bypasses environment filtering because we're reading the parent process's memory, not our own env.

**Why this matters:**
- Pullfrog Action (Node.js) has `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. in `process.env`
- We spawn agent CLI with filtered env (only its own API key)
- Agent CLI spawns MCP Bash tool
- MCP Bash tool spawns bash with filtered env (no secrets)
- BUT bash can read `/proc/$PPID/environ` → gets Node.js process's full env

---

## Solution: PID Namespace Isolation

We use Linux PID namespaces to hide the parent process:

```bash
unshare --pid --fork --mount-proc bash -c "$CMD"
```

| Flag | Purpose |
|------|---------|
| `--pid` | Create new PID namespace |
| `--fork` | Fork so child is actually in new namespace |
| `--mount-proc` | Mount fresh `/proc` for new namespace |

**Result:**
- Child sees itself as PID 1
- Child's PPID is 0 (doesn't exist)
- `/proc` only shows processes in child's namespace
- Parent's PID is invisible → `/proc/$PPID/environ` fails

---

## Implementation

### mcp/bash.ts

```typescript
import { spawn } from "node:child_process";

// filter sensitive env vars (defense in depth)
function filterEnv(): Record<string, string> {
  const SENSITIVE = [/_KEY$/i, /_SECRET$/i, /_TOKEN$/i, /^ANTHROPIC/i, ...];
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value && !SENSITIVE.some(p => p.test(key))) {
      filtered[key] = value;
    }
  }
  return filtered;
}

// spawn with PID namespace in GitHub Actions, plain spawn locally
function spawnSandboxed(command: string, options: { env, cwd }): ChildProcess {
  if (process.env.GITHUB_ACTIONS === "true") {
    return spawn("unshare", ["--pid", "--fork", "--mount-proc", "bash", "-c", command], options);
  }
  return spawn("bash", ["-c", command], options);
}
```

**Defense in depth:**
1. `filterEnv()` - prevents `env` and `echo $VAR` attacks
2. `unshare` - prevents `/proc/$PPID/environ` attack

---

## Disabling Native Bash Tools

Each agent has built-in Bash/Shell tools that we can't control. We disable them and force agents to use our MCP Bash tool:

```typescript
// Claude
disallowedTools: ["Bash"],

// Cursor  
permissions: { deny: ["Shell(**)"] }

// OpenCode
permission: { bash: "deny" }
```

---

## Testing

Run the vulnerability test in Docker:

```bash
# from action/ directory
docker run --rm \
  -v "$(pwd):/app/action:cached" \
  -v "pullfrog-action-node-modules:/app/action/node_modules" \
  -w /app/action \
  -e GITHUB_ACTIONS=true \
  -e TEST_SECRET_KEY=test-secret \
  -e ANTHROPIC_API_KEY=sk-test \
  --cap-add SYS_ADMIN \
  --security-opt seccomp:unconfined \
  node:22 bash -c "corepack enable pnpm && pnpm install --frozen-lockfile && node test/proc-environ-vuln.ts"
```

Expected output:
```
1. UNPROTECTED (filterEnv only):
   Leaked: YES ❌

2. PROTECTED (unshare --pid --fork --mount-proc):
   Leaked: NO ✓
```

---

## Platform Notes

| Environment | `GITHUB_ACTIONS` | Our approach |
|-------------|------------------|--------------|
| GitHub Actions (Linux) | `"true"` | filterEnv + unshare |
| Local dev (any OS) | unset | filterEnv only |

We check `GITHUB_ACTIONS=true` (set automatically by GitHub) rather than platform detection. This means:
- **In CI**: Full protection with PID namespace isolation
- **Locally**: Easier testing without Docker/unshare requirements

GitHub Actions uses Ubuntu runners where `unshare` works without root.

---

## What This Does NOT Protect Against

- **Network exfiltration**: Child has full network access
- **File access**: Child can read any file the runner can (same UID)
- **Resource exhaustion**: No cgroup limits

For those, you'd need `bwrap` with `--unshare-net`, `--ro-bind`, etc. But for the stated goal—preventing secret exfiltration via env—this is sufficient.

---

## Agent-Specific Notes

### Agents Using MCP Bash (Claude, Cursor, OpenCode)

These agents have their native Bash disabled. They use our `gh_pullfrog` MCP server's `bash` tool which implements `filterEnv()` + `unshare`.

### Gemini

Has built-in CI detection that filters shell env when `GITHUB_SHA` or `SURFACE=Github` is set. We set `SURFACE=Github` in our env. Double protection with our `createAgentEnv()`.

### Codex

Uses `shell_environment_policy` in config. Needs proper configuration or MCP bash fallback.
