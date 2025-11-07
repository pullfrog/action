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
  minify: true,
  sourcemap: false,
  // Mark all node_modules as external - Node.js will handle ESM/CJS interop natively
  // This avoids esbuild's require() polyfill which doesn't work in ESM
  packages: "external",
  // Mark optional peer dependencies as external
  external: [
    "@valibot/to-json-schema",
    "effect",
    "sury",
  ],
  // Enable tree-shaking to remove unused code
  treeShaking: true,
  // Drop console statements in production (but keep for debugging)
  drop: [],
});

console.log("✅ Build completed successfully!");

