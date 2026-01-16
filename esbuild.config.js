// @ts-check

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "fs";

// Plugin to strip shebangs from output files
/**
 * @type {import("esbuild").Plugin}
 */
const stripShebangPlugin = {
  name: "strip-shebang",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      // Strip shebang from the output file
      const outputFile = build.initialOptions.outfile;
      if (outputFile) {
        try {
          const content = readFileSync(outputFile, "utf8");
          // Remove shebang line from the beginning if present
          const withoutShebang = content.startsWith("#!")
            ? content.slice(content.indexOf("\n") + 1)
            : content;
          writeFileSync(outputFile, withoutShebang);
        } catch (error) {
          // File might not exist, ignore
        }
      }
    });
  },
};

/**
 * @type {import("esbuild").BuildOptions}
 */
const sharedConfig = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  minify: false,
  sourcemap: false,
  // Bundle all dependencies - GitHub Actions doesn't have node_modules
  // Only mark optional peer dependencies as external
  external: [
    "@valibot/to-json-schema",
    "effect",
    "sury",
  ],
  // Provide a proper require shim for CommonJS modules bundled into ESM
  // We use a unique variable name to avoid conflicts with bundled imports
  banner: {
    js: `import { createRequire as __createRequire } from 'module'; import { fileURLToPath as __fileURLToPath } from 'url'; import { dirname as __dirnameFn } from 'path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirnameFn(__filename);`,
  },
  // Enable tree-shaking to remove unused code
  treeShaking: true,
  // Drop console statements in production (but keep for debugging)
  drop: [],
};

// Build the main entry bundle
await build({
  ...sharedConfig,
  entryPoints: ["./entry.ts"],
  outfile: "./entry",
  plugins: [stripShebangPlugin],
});

// Build the get-installation-token action
await build({
  ...sharedConfig,
  entryPoints: ["./get-installation-token/entry.ts"],
  outfile: "./get-installation-token/entry",
  plugins: [stripShebangPlugin],
});

console.log("» build completed successfully");
