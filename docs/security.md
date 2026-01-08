# Bash Tool Security

> **Note**: Security measures described here apply to **PUBLIC repositories only**. For private repos, agents can use native bash with full environment access.

## Architecture (Public Repos)

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
│  │  │  - has built-in Bash tool (DISABLED for public)     │ │ │
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

**Key insight**: For **public repos**, the Pullfrog Action process has all secrets in `process.env`. Agent CLIs have built-in Bash tools that we can't trust since malicious actors can submit PRs with prompt injections. We disable those and provide our own MCP Bash tool that spawns subprocesses securely.

For **private repos**, the threat model is different — only trusted collaborators can trigger workflows, so we allow native bash with full environment access for better performance and compatibility.

---

## Public vs Private Repos

| Repo Visibility | Native Bash | Env Filtering | PID Isolation |
|-----------------|-------------|---------------|---------------|
| **Public** | Disabled | Yes | Yes (in CI) |
| **Private** | Enabled | No | No |

**Rationale**: Public repos are at risk from prompt injection attacks via pull requests from untrusted contributors. Private repos only allow trusted collaborators, so the attack surface is much smaller.

---

## Threat Model (Public Repos)

A prompt-injected agent could run malicious bash commands to exfiltrate API keys.

**Attack vectors:**

| Vector | Example | Mitigation |
|--------|---------|------------|
| Direct env access | `env \| grep KEY` | Filter env vars before spawn |
| Echo variable | `echo $ANTHROPIC_API_KEY` | Filter env vars before spawn |
| `/proc/$PPID/environ` | `cat /proc/$PPID/environ` | PID namespace isolation |

The first two are solved by passing filtered env to subprocess. The third requires special handling on Linux.

---

## Attack: /proc/$PPID/environ (Public Repos)

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

## Solution: PID Namespace Isolation (Public Repos)

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

// filter sensitive env vars (only for public repos)
function filterEnv(isPublicRepo: boolean): Record<string, string> {
  const SENSITIVE = [/_KEY$/i, /_SECRET$/i, /_TOKEN$/i, /_PASSWORD$/i, /_CREDENTIAL$/i];
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // only filter sensitive vars for public repos
    if (isPublicRepo && SENSITIVE.some(p => p.test(key))) continue;
    filtered[key] = value;
  }
  return filtered;
}

// spawn with PID namespace in CI for public repos, plain spawn otherwise
function spawnSandboxed(command: string, options: { env, cwd, isPublicRepo }): ChildProcess {
  const useNamespaceIsolation = process.env.CI === "true" && options.isPublicRepo;
  if (useNamespaceIsolation) {
    return spawn("unshare", ["--pid", "--fork", "--mount-proc", "bash", "-c", command], options);
  }
  return spawn("bash", ["-c", command], options);
}

// BashTool uses ctx.repo.private to determine visibility
export function BashTool(ctx: ToolContext) {
  const isPublicRepo = !ctx.repo.private;
  // ... spawns with filterEnv(isPublicRepo) and isPublicRepo flag
}
```

**Defense in depth (public repos only):**
1. `filterEnv(true)` - prevents `env` and `echo $VAR` attacks
2. `unshare` - prevents `/proc/$PPID/environ` attack

---

## Disabling Native Bash Tools (Public Repos)

For **public repos**, each agent's built-in Bash/Shell tools are disabled. Agents use our MCP Bash tool which filters secrets:

```typescript
// Claude - conditional based on repo.isPublic
const disallowedTools = repo.isPublic ? ["Bash"] : [];
{ permissionMode: "bypassPermissions", disallowedTools }

// Cursor - conditional shell denial
const denyShell = isPublicRepo ? ["Shell(*)"] : [];
{ permissions: { allow: ["Read(**)", "Write(**)"], deny: denyShell } }

// OpenCode - conditional bash denial
const bashPermission = isPublicRepo ? "deny" : "allow";
{ permission: { edit: "allow", bash: bashPermission, ... } }

// Gemini - uses excludeTools in ~/.gemini/settings.json
newSettings.excludeTools = ["run_shell_command"];

// Codex - NO SDK mechanism to disable native shell
// Relies on instructions only (limitation)
```

For **private repos**, native bash is allowed for all agents.

---

## Testing (Public Repo Scenario)

Run the vulnerability test in Docker to verify protection for public repos:

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

| Environment | Repo | Our approach |
|-------------|------|--------------|
| GitHub Actions (Linux) | Public | filterEnv + unshare + disable native bash |
| GitHub Actions (Linux) | Private | Full env + native bash allowed |
| Local dev (any OS) | Any | No filtering (local dev assumed trusted) |

We check `process.env.CI === "true"` (set by GitHub Actions) combined with `ctx.repo.private` to determine the security posture:
- **CI + Public repo**: Full protection with PID namespace isolation
- **CI + Private repo**: No protection (trusted collaborators only)
- **Local**: No protection (developer's own machine)

GitHub Actions uses Ubuntu runners where `unshare` works without root.

---

## What This Does NOT Protect Against (Public Repos)

Even with protections enabled, bash subprocesses can still:

- **Network exfiltration**: Child has full network access
- **File access**: Child can read any file the runner can (same UID)
- **Resource exhaustion**: No cgroup limits

For those, you'd need `bwrap` with `--unshare-net`, `--ro-bind`, etc. But for the stated goal—preventing secret exfiltration via env—this is sufficient.

For **private repos**, none of these protections apply since we trust collaborators.

---

## Agent-Specific Notes

### Claude, Cursor, OpenCode (Public Repos)

These agents have their native Bash disabled via configuration. They use our `gh_pullfrog` MCP server's `bash` tool which implements `filterEnv()` + `unshare`.

For private repos, native bash is enabled for these agents.

### Gemini (Public Repos)

Gemini CLI supports `excludeTools` in its user-level settings file (`~/.gemini/settings.json`). For public repos, we exclude the native shell tool:

```typescript
// written to ~/.gemini/settings.json
newSettings.excludeTools = ["run_shell_command"];
```

This is a blocklist approach which explicitly excludes the shell tool while allowing all other tools.

Additionally, Gemini has built-in CI detection that filters shell env when `GITHUB_SHA` is set.

### Codex (Limitation)

**⚠️ Codex SDK does not support disabling native shell commands.** The SDK only offers `sandboxMode` options which control filesystem access, not specific tool availability.

For public repos, we rely on:
1. **Instructions** telling the agent to use MCP bash instead of native shell
2. **MCP bash tool** being available as an alternative

This is a known limitation. Codex may still use native shell if it doesn't follow instructions.

### Summary by Agent

| Agent | Public Repo | Private Repo |
|-------|-------------|--------------|
| Claude | Native bash **disabled** | Native bash allowed |
| Cursor | Native shell **disabled** | Native shell allowed |
| OpenCode | Native bash **disabled** | Native bash allowed |
| Gemini | Native shell **disabled** (via excludeTools) | Native bash allowed |
| Codex | Instructions only (**⚠️ not enforced**) | Native bash allowed |
