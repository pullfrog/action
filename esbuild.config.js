import { build } from "esbuild";

const sharedConfig = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
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

// Build the main entry bundle (without MCP)
await build({
  ...sharedConfig,
  entryPoints: ["./entry.ts"],
  outfile: "./entry.js",
});

// Build the MCP server bundle
await build({
  ...sharedConfig,
  entryPoints: ["./mcp/server.ts"],
  outfile: "./mcp-server.js",
});

console.log("✅ Build completed successfully!");

