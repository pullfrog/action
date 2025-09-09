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
  minify: false,
  sourcemap: false,
});

console.log("✅ Build completed successfully!");
