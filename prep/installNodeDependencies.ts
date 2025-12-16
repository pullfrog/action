import { existsSync } from "node:fs";
import { join } from "node:path";
import { detect } from "package-manager-detector";
import { resolveCommand } from "package-manager-detector/commands";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import type { NodePackageManager, NodePrepResult, PrepDefinition } from "./types.ts";

// package managers that need installation (npm is always available)
type InstallablePackageManager = Exclude<NodePackageManager, "npm">;

// install commands for each package manager
const PM_INSTALL_COMMANDS: Record<InstallablePackageManager, string[]> = {
  pnpm: ["npm", "install", "-g", "pnpm"],
  yarn: ["npm", "install", "-g", "yarn"],
  bun: ["npm", "install", "-g", "bun"],
  deno: ["sh", "-c", "curl -fsSL https://deno.land/install.sh | sh"],
};

async function isCommandAvailable(command: string): Promise<boolean> {
  const result = await spawn({
    cmd: "which",
    args: [command],
    env: { PATH: process.env.PATH || "" },
  });
  return result.exitCode === 0;
}

async function installPackageManager(name: InstallablePackageManager): Promise<string | null> {
  log.info(`📦 installing ${name}...`);
  const [cmd, ...args] = PM_INSTALL_COMMANDS[name];
  const result = await spawn({
    cmd,
    args,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  if (result.exitCode !== 0) {
    return result.stderr || `failed to install ${name}`;
  }

  // deno installs to $HOME/.deno/bin - add to PATH for subsequent commands
  if (name === "deno") {
    const denoPath = join(process.env.HOME || "", ".deno", "bin");
    process.env.PATH = `${denoPath}:${process.env.PATH}`;
  }

  log.info(`✅ installed ${name}`);
  return null;
}

export const installNodeDependencies: PrepDefinition = {
  name: "installNodeDependencies",

  shouldRun: () => {
    const packageJsonPath = join(process.cwd(), "package.json");
    return existsSync(packageJsonPath);
  },

  run: async (): Promise<NodePrepResult> => {
    // detect package manager
    const detected = await detect({ cwd: process.cwd() });
    if (!detected) {
      return {
        language: "node",
        packageManager: "npm",
        dependenciesInstalled: false,
        issues: ["no package manager detected from lockfile"],
      };
    }

    const packageManager = detected.name as NodePackageManager;
    log.info(`📦 detected package manager: ${packageManager} (${detected.agent})`);

    // check if package manager is available, install if needed (npm is always available)
    if (packageManager !== "npm" && !(await isCommandAvailable(packageManager))) {
      log.info(`${packageManager} not found, attempting to install...`);
      const installError = await installPackageManager(packageManager);
      if (installError) {
        return {
          language: "node",
          packageManager,
          dependenciesInstalled: false,
          issues: [installError],
        };
      }
    }

    // get the frozen install command (or fallback to regular install)
    const resolved =
      resolveCommand(detected.agent, "frozen", []) || resolveCommand(detected.agent, "install", []);
    if (!resolved) {
      return {
        language: "node",
        packageManager,
        dependenciesInstalled: false,
        issues: [`no install command found for ${detected.agent}`],
      };
    }

    log.info(`running: ${resolved.command} ${resolved.args.join(" ")}`);
    const result = await spawn({
      cmd: resolved.command,
      args: resolved.args,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
      onStderr: (chunk) => process.stderr.write(chunk),
    });

    if (result.exitCode !== 0) {
      return {
        language: "node",
        packageManager,
        dependenciesInstalled: false,
        issues: [result.stderr || `${resolved.command} exited with code ${result.exitCode}`],
      };
    }

    return {
      language: "node",
      packageManager,
      dependenciesInstalled: true,
      issues: [],
    };
  },
};
