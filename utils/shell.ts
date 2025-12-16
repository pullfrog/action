import { spawnSync } from "node:child_process";

interface ShellOptions {
  cwd?: string;
  encoding?:
    | "utf-8"
    | "utf8"
    | "ascii"
    | "base64"
    | "base64url"
    | "hex"
    | "latin1"
    | "ucs-2"
    | "ucs2"
    | "utf16le";
  log?: boolean;
  env?: Record<string, string>;
  onError?: (result: { status: number; stdout: string; stderr: string }) => void;
}

/**
 * Execute a shell command safely using spawnSync with argument arrays.
 * Prevents shell injection by avoiding string interpolation in shell commands.
 *
 * @param cmd - The command to execute
 * @param args - Array of arguments to pass to the command
 * @param options - Optional configuration (cwd, encoding, onError)
 * @returns The trimmed stdout output
 * @throws Error if command fails and no onError handler is provided
 */
export function $(cmd: string, args: string[], options?: ShellOptions): string {
  const encoding = options?.encoding ?? "utf-8";

  // CRITICAL: use "ignore" for stdin instead of "inherit" to avoid breaking MCP transport
  // when running inside an MCP server, stdin is used for JSON-RPC protocol
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding,
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : undefined,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  // Write output to process streams so it behaves like stdio: "inherit"
  // CRITICAL: when running inside an MCP server, stdout is used for JSON-RPC protocol
  // so we must write to stderr instead to avoid corrupting the protocol
  // Only log if log option is not explicitly set to false
  if (options?.log !== false) {
    // if stdout is a TTY, it's safe to write to it; otherwise it's likely a pipe used for JSON-RPC
    const canWriteToStdout = process.stdout.isTTY === true;
    if (stdout) {
      if (canWriteToStdout) {
        process.stdout.write(stdout);
      } else {
        // stdout is a pipe (MCP context) - write to stderr instead
        process.stderr.write(stdout);
      }
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
  }

  // Handle errors
  if (result.status !== 0) {
    const errorResult = {
      status: result.status ?? -1,
      stdout,
      stderr,
    };

    if (options?.onError) {
      options.onError(errorResult);
      return stdout.trim();
    }

    throw new Error(
      `Command failed with exit code ${errorResult.status}: ${stderr || "Unknown error"}`
    );
  }

  return stdout.trim();
}
