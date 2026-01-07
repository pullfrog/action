/**
 * @pullfrog/sandbox - Landlock-based process sandboxing
 *
 * provides kernel-level filesystem and network restrictions that propagate
 * to all child processes and cannot be lifted.
 */

// try to load the native module, but handle missing gracefully
let native: typeof import("./sandbox.js") | null = null;

try {
  // the native module is built by napi-rs and named sandbox.${platform}.node
  native = require("./sandbox.linux-x64-gnu.node");
} catch {
  // native module not available - will use fallback behavior
}

/** filesystem permission configuration */
export interface FsConfig {
  /** paths with read access */
  read?: string[] | undefined;
  /** paths with write access */
  write?: string[] | undefined;
  /** paths with execute access (binaries that can be run) */
  execute?: string[] | undefined;
}

/** network permission configuration */
export interface NetConfig {
  /** ports allowed for TCP connect (empty = no network access) */
  connectPorts?: number[] | undefined;
}

/** sandbox configuration */
export interface SandboxConfig {
  /** filesystem permissions */
  fs?: FsConfig | undefined;
  /** network permissions */
  net?: NetConfig | undefined;
}

/** result of checking Landlock support */
export interface LandlockSupport {
  /** whether Landlock is supported at all */
  supported: boolean;
  /** the best ABI version available (0-5), or 0 if not supported */
  abiVersion: number;
  /** whether network rules are supported (requires ABI v4+) */
  networkSupported: boolean;
  /** human-readable status message */
  message: string;
}

/** permissions config from payload - matches DispatchOptions.permissions */
export interface PermissionsConfig {
  /** restrict to read-only fs access */
  readonly?: boolean;
  /** allow network access */
  network?: boolean;
  /** allow bash/shell execution */
  bash?: boolean;
  /** additional writable paths */
  allowedPaths?: string[];
}

/**
 * check if Landlock is supported on this system
 */
export function isLandlockSupported(): LandlockSupport {
  if (!native) {
    return {
      supported: false,
      abiVersion: 0,
      networkSupported: false,
      message: "native module not available (non-Linux or not built)",
    };
  }

  const result = native.isLandlockSupported();
  return {
    supported: result.supported,
    abiVersion: result.abi_version,
    networkSupported: result.network_supported,
    message: result.message,
  };
}

/**
 * apply sandbox restrictions to the current process.
 * these restrictions are inherited by all child processes and cannot be lifted.
 *
 * if Landlock is not supported and PULLFROG_DISABLE_LANDLOCK=1 is set,
 * logs a warning and continues without sandboxing.
 *
 * @throws if Landlock is not supported and PULLFROG_DISABLE_LANDLOCK is not set
 */
export function applySandbox(config: SandboxConfig): void {
  const support = isLandlockSupported();
  const disableLandlock = process.env.PULLFROG_DISABLE_LANDLOCK === "1";

  if (!support.supported) {
    if (disableLandlock) {
      console.warn(
        "⚠️ Landlock not available. Running WITHOUT sandbox restrictions. " +
          "This is fine for local dev but should not happen in CI."
      );
      return;
    }

    throw new Error(
      `Landlock not available: ${support.message}. ` +
        "Set PULLFROG_DISABLE_LANDLOCK=1 for local development on unsupported systems."
    );
  }

  if (!native) {
    throw new Error("native module not loaded but support check passed - this should not happen");
  }

  // convert config to native format
  const nativeConfig = {
    fs: config.fs
      ? {
          read: config.fs.read,
          write: config.fs.write,
          execute: config.fs.execute,
        }
      : undefined,
    net: config.net
      ? {
          connect_ports: config.net.connectPorts,
        }
      : undefined,
  };

  native.applySandbox(nativeConfig);
}

/**
 * build a SandboxConfig from the high-level PermissionsConfig.
 * uses sensible defaults for CI environments.
 */
export function buildSandboxConfig(permissions: PermissionsConfig): SandboxConfig {
  const cwd = process.cwd();
  const home = process.env.HOME || "/home/runner";
  const tempDir = process.env.PULLFROG_TEMP_DIR || "/tmp";

  // default read paths - always allowed
  const readPaths = [
    cwd,
    "/usr",
    "/lib",
    "/lib64",
    "/opt/hostedtoolcache",
    "/etc",
    home,
    tempDir,
    "/proc",
    "/sys/kernel/security", // for Landlock detection
  ];

  // write paths - only if not readonly
  const writePaths = permissions.readonly
    ? []
    : [cwd, tempDir, ...(permissions.allowedPaths || [])];

  // execute paths - always include node, git; conditionally include bash
  const executePaths = [
    "/usr/bin/node",
    "/usr/local/bin/node",
    "/opt/hostedtoolcache/node", // GitHub Actions node installations
    "/usr/bin/git",
    "/usr/bin/env",
    // common paths needed for various operations
    "/usr/bin/tar",
    "/usr/bin/gzip",
    "/usr/bin/unzip",
    "/bin/cat",
    "/bin/ls",
    "/bin/mkdir",
    "/bin/rm",
    "/bin/cp",
    "/bin/mv",
  ];

  // add bash/shell if allowed
  if (permissions.bash !== false) {
    executePaths.push(
      "/bin/bash",
      "/bin/sh",
      "/usr/bin/bash",
      "/usr/bin/sh",
      "/bin/dash"
    );
  }

  return {
    fs: {
      read: readPaths,
      write: writePaths,
      execute: executePaths,
    },
    // network config - empty connectPorts means no network allowed
    net: permissions.network
      ? { connectPorts: [] } // empty = all ports (not restricted)
      : undefined, // undefined = no network access
  };
}

