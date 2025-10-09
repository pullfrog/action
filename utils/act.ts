import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { buildAction, setupTestRepo } from "./setup.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tempDir = join(__dirname, "..", ".temp");
const actionPath = join(__dirname, "..");
const envPath = join(__dirname, "..", "..", ".env");

const ENV_VARS = ["ANTHROPIC_API_KEY", "GITHUB_INSTALLATION_TOKEN"];

export function runAct(prompt: string): void {
  setupTestRepo({ tempDir });

  config({ path: envPath });

  buildAction(actionPath);

  const workflowPath = join(tempDir, ".github", "workflows", "pullfrog.yml");

  const distPath = join(actionPath, ".act-dist");
  console.log("📦 Creating minimal distribution for act...");
  execSync(`rm -rf "${distPath}" && mkdir -p "${distPath}"`, { shell: "/bin/bash" });

  ["action.yml", "entry.cjs", "index.cjs", "package.json"].forEach((file) => {
    const src = join(actionPath, file);
    if (existsSync(src)) {
      execSync(`cp "${src}" "${distPath}"`);
    }
  });

  try {
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

    ENV_VARS.forEach((key) => {
      if (process.env[key]) {
        actCommandParts.push("-s", key);
      }
    });


    const actCommand = actCommandParts.join(" ");

    console.log("🚀 Running act with prompt:");
    console.log("─".repeat(50));
    console.log(prompt);
    console.log("─".repeat(50));
    console.log("");

    execSync(actCommand, {
      stdio: "inherit",
      cwd: join(__dirname, "..", ".."),
    });
    execSync(`rm -rf "${distPath}"`);
  } catch (error) {
    execSync(`rm -rf "${distPath}"`);
    console.error("❌ Act execution failed:", (error as Error).message);
    process.exit(1);
  }
}
