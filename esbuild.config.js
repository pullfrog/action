import { build } from "esbuild";

// Build the GitHub Action bundle only
// For npm package builds, use zshy (pnpm build:npm)
await build({
  entryPoints: ["./entry.ts"],
  bundle: true,
  outfile: "./entry.js",
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
  banner: {
    js: `import { createRequire } from 'module'; import { fileURLToPath } from 'url'; import { dirname } from 'path'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);`,
  },
  // Enable tree-shaking to remove unused code
  treeShaking: true,
  // Drop console statements in production (but keep for debugging)
  drop: [],
});

console.log("✅ Build completed successfully!");

