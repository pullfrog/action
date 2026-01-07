/** native module type declarations */

export interface FsConfig {
  read?: string[] | undefined;
  write?: string[] | undefined;
  execute?: string[] | undefined;
}

export interface NetConfig {
  connect_ports?: number[] | undefined;
}

export interface SandboxConfig {
  fs?: FsConfig | undefined;
  net?: NetConfig | undefined;
}

export interface LandlockSupportResult {
  supported: boolean;
  abi_version: number;
  network_supported: boolean;
  message: string;
}

export function isLandlockSupported(): LandlockSupportResult;
export function applySandbox(config: SandboxConfig): void;

