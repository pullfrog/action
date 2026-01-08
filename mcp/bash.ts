import { type ChildProcess, spawn } from "node:child_process";
import { type } from "arktype";
import type { ToolContext } from "../main.ts";
import { execute, tool } from "./shared.ts";

export const BashParams = type({
  command: "string",
  description: "string",
  "timeout?": "number",
  "working_directory?": "string",
});

// patterns for sensitive env vars: suffixes (_KEY, _SECRET, _TOKEN) plus AI provider prefixes
const SENSITIVE_PATTERNS = [
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /^ANTHROPIC/i,
  /^OPENAI/i,
  /^GEMINI/i,
  /^GOOGLE/i,
  /^CLAUDE/i,
  /^CODEX/i,
  /^CURSOR/i,
  /^AWS/i,
  /^GITHUB_TOKEN$/i,
  /^GH_TOKEN$/i,
];

function isSensitive(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

/** filter env vars, removing sensitive values */
function filterEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isSensitive(key)) filtered[key] = value;
  }
  return filtered;
}

/**
 * spawn command with filtered env. in CI, also use PID namespace isolation
 * to prevent child from reading /proc/$PPID/environ
 */
function spawnSandboxed(
  command: string,
  options: { env: Record<string, string>; cwd: string },
): ChildProcess {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
  const spawnOpts = { env: options.env, cwd: options.cwd, stdio, detached: true };
  return process.env.GITHUB_ACTIONS === "true"
    ? spawn("unshare", ["--pid", "--fork", "--mount-proc", "bash", "-c", command], spawnOpts)
    : spawn("bash", ["-c", command], spawnOpts);
}

/** kill process and its entire process group */
async function killProcessGroup(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    try { proc.kill("SIGKILL"); } catch { /* already dead */ }
  }
}

export function BashTool(_ctx: ToolContext) {
  return tool({
    name: "bash",
    description: `Execute shell commands securely. Environment is filtered to remove API keys and secrets.

Use this tool to:
- Run shell commands (ls, cat, grep, find, etc.)
- Execute build tools (npm, pnpm, cargo, make, etc.)
- Run tests and linters
- Perform git operations

The command runs in a bash shell with a filtered environment that excludes sensitive variables like API keys and tokens.`,
    parameters: BashParams,
    execute: execute(async (params) => {
      const timeout = Math.min(params.timeout ?? 120000, 600000);
      const cwd = params.working_directory ?? process.cwd();
      const proc = spawnSandboxed(params.command, { env: filterEnv(), cwd });

      let stdout = "", stderr = "", timedOut = false, exited = false;
      proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      const timeoutId = setTimeout(async () => {
        if (!exited) { timedOut = true; await killProcessGroup(proc); }
      }, timeout);

      const exitCode = await new Promise<number | null>((resolve) => {
        const done = (code: number | null) => { exited = true; clearTimeout(timeoutId); resolve(code); };
        proc.on("exit", done);
        proc.on("error", () => done(null));
      });

      let output = stderr ? (stdout ? `${stdout}\n${stderr}` : stderr) : stdout;
      if (timedOut) output = output ? `${output}\n[timed out after ${timeout}ms]` : `[timed out after ${timeout}ms]`;

      return { output: output.trim(), exit_code: exitCode ?? (timedOut ? 124 : -1), timed_out: timedOut };
    }),
  });
}
