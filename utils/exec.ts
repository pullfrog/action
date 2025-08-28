import { exec } from "node:child_process";
import { promisify } from "node:util";

export const execAsync = promisify(exec);

/**
 * Execute a shell command with optional environment variables
 */
export async function executeCommand(
  command: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const execEnv = env ? { ...process.env, ...env } : process.env;
  return execAsync(command, { env: execEnv });
}
