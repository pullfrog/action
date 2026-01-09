/**
 * landlock-based sandboxing for pullfrog agent execution.
 * applies filesystem and network restrictions that inherit to all child processes.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../utils/cli.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// types for the native addon
export interface SandboxConfig {
  /** when true, blocks writes to the working directory (repo checkout) */
  readonly: boolean;
  /** when true, network is enabled (default). when false, network is blocked */
  network: boolean;
}

export interface SupportResult {
  supported: boolean;
  reason: string | null;
  abiVersion: number | null;
}

// native addon interface - will be loaded dynamically
interface NativeAddon {
  isLandlockSupported(): SupportResult;
  applySandbox(config: SandboxConfig, workingDir: string): void;
}

let nativeAddon: NativeAddon | null = null;
let loadAttempted = false;
let loadError: Error | null = null;

/**
 * attempt to load the native addon.
 * returns null if not available (e.g., non-linux platform).
 */
async function loadNativeAddon(): Promise<NativeAddon | null> {
  if (loadAttempted) {
    return nativeAddon;
  }
  loadAttempted = true;

  // only supported on linux
  if (process.platform !== "linux") {
    loadError = new Error(`landlock only supported on linux, current platform: ${process.platform}`);
    return null;
  }

  try {
    // try to load the native addon
    // the .node file should be in the same directory after build
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const addonPath = join(__dirname, "pullfrog-sandbox.linux-x64-gnu.node");
    const addon = require(addonPath) as NativeAddon;
    nativeAddon = addon;
    return addon;
  } catch (e) {
    loadError = e instanceof Error ? e : new Error(String(e));
    return null;
  }
}

/**
 * check if landlock sandboxing is supported on this system.
 */
export async function isLandlockSupported(): Promise<SupportResult> {
  const addon = await loadNativeAddon();

  if (!addon) {
    return {
      supported: false,
      reason: loadError?.message ?? "native addon not available",
      abiVersion: null,
    };
  }

  return addon.isLandlockSupported();
}

/**
 * apply sandbox restrictions to the current process.
 * these restrictions inherit to all child processes and cannot be removed.
 *
 * @param config - sandbox configuration
 * @param workingDir - the working directory (repo checkout) to protect
 * @throws if landlock is not available or restrictions cannot be applied
 */
export async function applySandbox(config: SandboxConfig, workingDir: string): Promise<void> {
  const addon = await loadNativeAddon();

  if (!addon) {
    throw new Error(`cannot apply sandbox: ${loadError?.message ?? "native addon not available"}`);
  }

  log.info(`applying landlock sandbox: readonly=${config.readonly}, network=${config.network}, workingDir=${workingDir}`);
  addon.applySandbox(config, workingDir);
  log.info("landlock sandbox applied successfully");
}

/**
 * conditionally apply sandbox based on permissions and environment.
 * - if CI=true and landlock not supported: throws
 * - if CI=false and landlock not supported: logs warning and continues
 * - if permissions don't require sandboxing: does nothing
 */
export async function applySandboxIfNeeded(params: {
  readonly?: boolean | undefined;
  network?: boolean | undefined;
  workingDir: string;
}): Promise<void> {
  const needsSandbox = params.readonly === true || params.network === false;

  if (!needsSandbox) {
    return;
  }

  const support = await isLandlockSupported();

  if (!support.supported) {
    if (process.env.CI === "true") {
      throw new Error(`landlock not supported: ${support.reason}`);
    }
    log.warning(`landlock not supported: ${support.reason} - running without sandbox`);
    return;
  }

  await applySandbox(
    {
      readonly: params.readonly ?? false,
      network: params.network ?? true,
    },
    params.workingDir
  );
}
