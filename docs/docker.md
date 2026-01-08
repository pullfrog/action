# Docker Testing Environment

`play.ts` runs in Docker by default for realistic testing (Linux, clean $HOME, matches CI).

## Usage

```bash
pnpm play bash-test.ts           # runs in Docker (default)
pnpm play --local bash-test.ts   # runs on macOS (fast iteration)
PLAY_LOCAL=1 pnpm play ...       # same as --local
```

## Why Docker by Default?

1. **Matches CI** - Linux environment like GitHub Actions
2. **Clean $HOME** - No agent config pollution from `~/.claude`, `~/.cursor`
3. **Tests unshare** - Verifies PID namespace sandbox works
4. **Reproducible** - Same environment every run

## Performance

| Mode | Overhead |
|------|----------|
| Docker (cached deps) | ~1.5s |
| Local (macOS) | ~0s |

For agent runs taking 30-120s, the 1.5s overhead is negligible.

## How It Works

1. `play.ts` runs on host, loads `.env`
2. Spawns Docker container with:
   - Volume-mounted `action/` code
   - Named volume for Linux node_modules (persists between runs)
   - SSH agent forwarding for git clone
   - Env vars passed via `-e` flags
3. Inside Docker, `play.ts` runs again (detects `/.dockerenv` file)
4. Clones `GITHUB_REPOSITORY`, runs agent

## Troubleshooting

**Docker not running:**
```
Cannot connect to the Docker daemon
```
→ Start Docker Desktop

**SSH clone fails:**
```
Permission denied (publickey)
```
→ Ensure SSH agent is running: `ssh-add -l`
