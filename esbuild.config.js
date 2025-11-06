import { build } from "esbuild";

// Build the GitHub Action bundle only
// For npm package builds, use zshy (pnpm build:npm)
await build({
  entryPoints: ["./entry.ts"],
  bundle: true,
  outfile: "./entry.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: true,
  sourcemap: false,
  // Mark optional peer dependencies as external to avoid bundling errors
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

