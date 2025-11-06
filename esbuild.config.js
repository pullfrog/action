import { build } from "esbuild";

// Build the GitHub Action bundle only
// For npm package builds, use zshy (pnpm build:npm)
await build({
  entryPoints: ["./entry.build.ts"],
  bundle: true,
  outfile: "./entry.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: true,
  sourcemap: false,
  // @actions/core is provided by GitHub Actions runtime, but we still need it bundled
  // for local testing. However, we can mark it to reduce duplication if needed.
  external: [],
  // Enable tree-shaking to remove unused code
  treeShaking: true,
  // Drop console statements in production (but keep for debugging)
  drop: [],
});

console.log("✅ Build completed successfully!");

