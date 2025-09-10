import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { buildAction, setupTestRepo } from "./setup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment variables that should be passed as secrets to the workflow
const ENV_VARS = ["ANTHROPIC_API_KEY", "GITHUB_INSTALLATION_TOKEN"];

export function runAct(prompt: string): void {
  const tempDir = join(__dirname, "..", ".temp");
  const actionPath = join(__dirname, "..");
  const envPath = join(__dirname, "..", "..", ".env");

  // Setup test repository
  setupTestRepo({ tempDir });

  // Load environment variables
  config({ path: envPath });

  // Build action bundles
  buildAction(actionPath);

  const workflowPath = join(tempDir, ".github", "workflows", "pullfrog.yml");

  // Create minimal dist for act (avoids pnpm symlink issues)
  const distPath = join(actionPath, ".act-dist");
  console.log("📦 Creating minimal distribution for act...");
  execSync(`rm -rf "${distPath}" && mkdir -p "${distPath}"`, { shell: "/bin/bash" });

  // Copy only necessary files (bundled, no node_modules needed)
  ["action.yml", "entry.cjs", "index.cjs", "package.json"].forEach((file) => {
    const src = join(actionPath, file);
    if (existsSync(src)) {
      execSync(`cp "${src}" "${distPath}"`);
    }
  });

  try {
    // Build the act command with input directly
    // Properly escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    const actCommandParts = [
      "act",
      "workflow_dispatch",
      "-W",
      workflowPath,
      "--input",
      `prompt='${escapedPrompt}'`,
      "--local-repository",
      `pullfrog/action@v0=${distPath}`, // Use minimal dist without symlinks
    ];

    // Add environment variables as secrets that will be available to the workflow
    ENV_VARS.forEach((key) => {
      if (process.env[key]) {
        actCommandParts.push("-s", key);
      }
    });

    // We only need the specific ENV_VARS, no need to add other variables

    const actCommand = actCommandParts.join(" ");

    console.log("🚀 Running act with prompt:");
    console.log("─".repeat(50));
    console.log(prompt);
    console.log("─".repeat(50));
    console.log("");

    // Execute act
    execSync(actCommand, {
      stdio: "inherit",
      cwd: join(__dirname, "..", ".."),
    });
    // Clean up
    execSync(`rm -rf "${distPath}"`);
  } catch (error) {
    // Clean up on error
    execSync(`rm -rf "${distPath}"`);
    console.error("❌ Act execution failed:", (error as Error).message);
    process.exit(1);
  }
}
