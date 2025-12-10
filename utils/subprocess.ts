import { spawn as nodeSpawn } from "node:child_process";

export interface SpawnOptions {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
  timeout?: number;
  cwd?: string;
  stdio?: ("pipe" | "ignore" | "inherit")[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Spawn a subprocess with streaming callbacks and buffered results
 */
export async function spawn(options: SpawnOptions): Promise<SpawnResult> {
  const { cmd, args, env, input, timeout, cwd, stdio, onStdout, onStderr } = options;

  const startTime = Date.now();
  let stdoutBuffer = "";
  let stderrBuffer = "";

  return new Promise((resolve, reject) => {
    // security: caller must provide complete env object, not merged with process.env
    const child = nodeSpawn(cmd, args, {
      env: env || {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
      },
      stdio: stdio || ["pipe", "pipe", "pipe"],
      cwd: cwd || process.cwd(),
    });

    let timeoutId: NodeJS.Timeout | undefined;
    let isTimedOut = false;

    if (timeout) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        child.kill("SIGTERM");

        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);
    }

    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdoutBuffer += chunk;
        onStdout?.(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        onStderr?.(chunk);
      });
    }

    child.on("close", (exitCode) => {
      const durationMs = Date.now() - startTime;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (isTimedOut) {
        reject(new Error(`Process timed out after ${timeout}ms`));
        return;
      }

      resolve({
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode: exitCode || 0,
        durationMs,
      });
    });

    child.on("error", (error) => {
      const durationMs = Date.now() - startTime;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // log spawn errors for debugging
      console.error(`[spawn] Process spawn error: ${error.message}`);

      resolve({
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode: 1,
        durationMs,
      });
    });

    if (input && child.stdin && stdio?.[0] !== "ignore") {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}
