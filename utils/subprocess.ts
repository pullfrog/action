import { spawn as nodeSpawn } from "node:child_process";

export interface SpawnOptions {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
  timeout?: number;
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
  const { cmd, args, env, input, timeout, onStdout, onStderr } = options;

  const startTime = Date.now();
  let stdoutBuffer = "";
  let stderrBuffer = "";

  return new Promise((resolve, reject) => {
    // Spawn the child process
    const child = nodeSpawn(cmd, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Set up timeout if specified
    let timeoutId: NodeJS.Timeout | undefined;
    let isTimedOut = false;

    if (timeout) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        child.kill("SIGTERM");

        // If SIGTERM doesn't work, use SIGKILL after 5 seconds
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);
    }

    // Handle stdout streaming
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdoutBuffer += chunk;
        onStdout?.(chunk);
      });
    }

    // Handle stderr streaming
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        onStderr?.(chunk);
      });
    }

    // Handle process completion
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

    // Handle process errors
    child.on("error", (error) => {
      const durationMs = Date.now() - startTime;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Still return buffered output even on error
      resolve({
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode: 1,
        durationMs,
      });
    });

    // Send input if provided
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}
