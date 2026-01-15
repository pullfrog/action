import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isKeyOf } from "@ark/util";
import { detect } from "package-manager-detector";
import { resolveCommand } from "package-manager-detector/commands";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import type { NodePackageManager, NodePrepResult, PrepDefinition } from "./types.ts";

// install command templates for each package manager (version placeholder: {version})
const nodePackageManagers: Record<NodePackageManager, string[]> = {
  npm: ["echo", "npm is already installed"],
  pnpm: ["npm", "install", "-g", "{version}"],
  yarn: ["npm", "install", "-g", "{version}"],
  bun: ["npm", "install", "-g", "{version}"],
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

interface PackageManagerSpec {
  name: NodePackageManager;
  installSpec: string; // e.g., "pnpm@8.15.0" (without hash suffix)
}

function getPackageManagerFromPackageJson(): PackageManagerSpec | null {
  const packageJsonPath = join(process.cwd(), "package.json");
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { packageManager?: string };
    if (!pkg.packageManager) return null;

    // format: "pnpm@8.15.0" or "pnpm@8.15.0+sha512.abc123..."
    // strip the hash suffix (+sha256.xxx) as npm install doesn't understand it
    const withoutHash = pkg.packageManager.split("+")[0];
    const name = withoutHash.split("@")[0];
    if (isKeyOf(name, nodePackageManagers)) {
      return { name, installSpec: withoutHash };
    }
    log.warning(`unknown packageManager in package.json: ${pkg.packageManager}`);
    return null;
  } catch {
    return null;
  }
}

async function installPackageManager(
  name: NodePackageManager,
  installSpec: string
): Promise<string | null> {
  if (name === "npm") return null; // npm is always available
  log.info(`📦 installing ${installSpec}...`);
  const [cmd, ...templateArgs] = nodePackageManagers[name];
  const args = templateArgs.map((arg) => (arg === "{version}" ? installSpec : arg));
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
    // check packageManager field in package.json first (takes priority)
    const fromPackageJson = getPackageManagerFromPackageJson();

    // detect from lockfile as fallback
    const detected = await detect({ cwd: process.cwd() });

    // prefer package.json field, fall back to lockfile detection, default to npm
    const packageManager = fromPackageJson?.name || (detected?.name as NodePackageManager) || "npm";
    const installSpec = fromPackageJson?.installSpec || packageManager;
    const agent = detected?.agent || packageManager;

    if (fromPackageJson) {
      log.info(`📦 using packageManager from package.json: ${fromPackageJson.installSpec}`);
    } else if (detected) {
      log.info(`📦 detected package manager: ${packageManager} (${agent})`);
    } else {
      log.info(`📦 no package manager detected, defaulting to npm`);
    }

    // check if package manager is available, install if needed
    if (!(await isCommandAvailable(packageManager))) {
      log.info(`${packageManager} not found, attempting to install...`);
      const installError = await installPackageManager(packageManager, installSpec);
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
    const resolved = resolveCommand(agent, "frozen", []) || resolveCommand(agent, "install", []);
    if (!resolved) {
      return {
        language: "node",
        packageManager,
        dependenciesInstalled: false,
        issues: [`no install command found for ${agent}`],
      };
    }

    const fullCommand = `${resolved.command} ${resolved.args.join(" ")}`;
    log.info(`running: ${fullCommand}`);
    const result = await spawn({
      cmd: resolved.command,
      args: resolved.args,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });

    if (result.exitCode !== 0) {
      // combine stdout and stderr for better error context (pnpm often outputs errors to stdout)
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const errorMessage = output || `exited with code ${result.exitCode}`;
      return {
        language: "node",
        packageManager,
        dependenciesInstalled: false,
        issues: [`\`${fullCommand}\` failed:\n${errorMessage}`],
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
