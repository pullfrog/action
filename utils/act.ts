import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, parse } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function runAct(prompt: string): void {
  // First, ensure the scratch repo is cloned
  const tempDir = join(__dirname, "..", ".temp");

  // Check if .temp exists and either reset it or clone it
  if (existsSync(tempDir)) {
    console.log("📦 Resetting existing .temp repository...");
    execSync("git reset --hard HEAD && git clean -fd", {
      cwd: tempDir,
      stdio: "inherit",
    });
  } else {
    console.log("📦 Cloning pullfrogai/scratch into .temp...");
    const repoUrl = "git@github.com:pullfrogai/scratch.git";
    execSync(`git clone ${repoUrl} ${tempDir}`, { stdio: "inherit" });
  }

  const workflowPath = join(tempDir, ".github", "workflows", "pullfrog.yml");
  const envPath = join(__dirname, "..", "..", ".env");

  // Load environment variables into process
  config({ path: envPath });

  // Parse environment variables from .env file to get keys
  let envVars: string[] = [];
  try {
    const content = readFileSync(envPath, "utf8");
    const parsed = parse(content);
    envVars = Object.keys(parsed);
  } catch (error) {
    console.warn(
      `Warning: Could not read .env file: ${(error as Error).message}`,
    );
  }

  // Build fresh bundles with esbuild
  const actionPath = join(__dirname, "..");
  console.log("🔨 Building fresh bundles with esbuild...");
  execSync("node esbuild.config.js", {
    cwd: actionPath,
    stdio: "inherit",
  });

  // Create minimal dist for act (avoids pnpm symlink issues)
  const distPath = join(actionPath, ".act-dist");
  console.log("📦 Creating minimal distribution for act...");
  execSync(`rm -rf "${distPath}" && mkdir -p "${distPath}"`, { shell: true });

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
      `pullfrog/pullfrog@v0=${distPath}`, // Use minimal dist without symlinks
    ];

    // Add all environment variables as secrets (without values)
    envVars.forEach((key) => {
      actCommandParts.push("-s", key);
    });

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
