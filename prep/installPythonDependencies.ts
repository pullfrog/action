import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import type { PrepDefinition, PythonPackageManager, PythonPrepResult } from "./types.ts";

interface PythonConfig {
  file: string;
  tool: PythonPackageManager;
  installCmd: string[];
}

// python dependency file patterns in priority order
const PYTHON_CONFIGS: PythonConfig[] = [
  {
    file: "requirements.txt",
    tool: "pip",
    installCmd: ["pip", "install", "-r", "requirements.txt"],
  },
  {
    file: "pyproject.toml",
    tool: "pip",
    installCmd: ["pip", "install", "."],
  },
  {
    file: "Pipfile",
    tool: "pipenv",
    installCmd: ["pipenv", "install"],
  },
  {
    file: "Pipfile.lock",
    tool: "pipenv",
    installCmd: ["pipenv", "sync"],
  },
  {
    file: "poetry.lock",
    tool: "poetry",
    installCmd: ["poetry", "install", "--no-interaction"],
  },
  {
    file: "setup.py",
    tool: "pip",
    installCmd: ["pip", "install", "-e", "."],
  },
];

// tool install commands (via pip)
const TOOL_INSTALL_COMMANDS: Record<string, string[]> = {
  pipenv: ["pip", "install", "pipenv"],
  poetry: ["pip", "install", "poetry"],
};

async function isCommandAvailable(command: string): Promise<boolean> {
  const result = await spawn({
    cmd: "which",
    args: [command],
    env: { PATH: process.env.PATH || "" },
  });
  return result.exitCode === 0;
}

async function installTool(name: string): Promise<string | null> {
  const installCmd = TOOL_INSTALL_COMMANDS[name];
  if (!installCmd) {
    // tool doesn't need installation (e.g., pip)
    return null;
  }

  log.info(`» installing ${name}...`);
  const [cmd, ...args] = installCmd;
  const result = await spawn({
    cmd,
    args,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  if (result.exitCode !== 0) {
    return result.stderr || `failed to install ${name}`;
  }

  log.info(`» installed ${name}`);
  return null;
}

export const installPythonDependencies: PrepDefinition = {
  name: "installPythonDependencies",

  shouldRun: async () => {
    // check if python is available
    const hasPython = (await isCommandAvailable("python3")) || (await isCommandAvailable("python"));
    if (!hasPython) {
      return false;
    }

    // check if any python config file exists
    const cwd = process.cwd();
    return PYTHON_CONFIGS.some((config) => existsSync(join(cwd, config.file)));
  },

  run: async (): Promise<PythonPrepResult> => {
    const cwd = process.cwd();

    // find the first matching config
    const config = PYTHON_CONFIGS.find((c) => existsSync(join(cwd, c.file)));
    if (!config) {
      return {
        language: "python",
        packageManager: "pip",
        configFile: "unknown",
        dependenciesInstalled: false,
        issues: ["no python config file found"],
      };
    }

    log.info(`» detected python config: ${config.file} (using ${config.tool})`);

    // check if the tool is available, install if needed
    const isAvailable = await isCommandAvailable(config.tool);
    if (!isAvailable) {
      log.info(`» ${config.tool} not found, attempting to install...`);
      const installError = await installTool(config.tool);
      if (installError) {
        return {
          language: "python",
          packageManager: config.tool,
          configFile: config.file,
          dependenciesInstalled: false,
          issues: [installError],
        };
      }
    }

    // run the install command
    const [cmd, ...args] = config.installCmd;
    log.info(`» running: ${cmd} ${args.join(" ")}`);
    const result = await spawn({
      cmd,
      args,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
      onStderr: (chunk) => process.stderr.write(chunk),
    });

    if (result.exitCode !== 0) {
      return {
        language: "python",
        packageManager: config.tool,
        configFile: config.file,
        dependenciesInstalled: false,
        issues: [result.stderr || `${cmd} exited with code ${result.exitCode}`],
      };
    }

    return {
      language: "python",
      packageManager: config.tool,
      configFile: config.file,
      dependenciesInstalled: true,
      issues: [],
    };
  },
};
