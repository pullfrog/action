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
  const result = spawnSync(cmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    encoding,
    cwd: options?.cwd,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  // Write output to process streams so it behaves like stdio: "inherit"
  // Only log if log option is not explicitly set to false
  if (options?.log !== false) {
    if (stdout) {
      process.stdout.write(stdout);
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
