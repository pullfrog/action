interface PrepResultBase {
  dependenciesInstalled: boolean;
  issues: string[];
}

export type NodePackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

export interface NodePrepResult extends PrepResultBase {
  language: "node";
  packageManager: NodePackageManager;
}

export type PythonPackageManager = "pip" | "pipenv" | "poetry";

export interface PythonPrepResult extends PrepResultBase {
  language: "python";
  packageManager: PythonPackageManager;
  configFile: string;
}

export interface UnknownLanguagePrepResult extends PrepResultBase {
  language: "unknown";
}

export type PrepResult = NodePrepResult | PythonPrepResult | UnknownLanguagePrepResult;

export interface PrepDefinition {
  name: string;
  shouldRun: () => Promise<boolean> | boolean;
  run: () => Promise<PrepResult>;
}
