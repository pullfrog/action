import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { agentsManifest } from "../external.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const actionDir = join(__dirname, "..");

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

interface Spinner {
  stop: () => void;
}

function startSpinner(message: string): Spinner {
  let frameIndex = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    const elapsed = formatElapsed(Date.now() - startTime);
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stdout.write(`\r${frame} ${message} (${elapsed})...`);
    frameIndex++;
  }, 100);

  return {
    stop: () => {
      clearInterval(interval);
      const elapsed = formatElapsed(Date.now() - startTime);
      process.stdout.write(`\r${" ".repeat(60)}\r`); // clear line
      console.log(`✓ ${message} completed in ${elapsed}\n`);
    },
  };
}

// load .env files
config({ path: join(actionDir, ".env") });
config({ path: join(actionDir, "..", ".env") });

export const agents = Object.keys(agentsManifest) as (keyof typeof agentsManifest)[];

export interface AgentResult {
  agent: string;
  success: boolean;
  output: string;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
}

export interface ValidationResult {
  agent: string;
  passed: boolean;
  checks: ValidationCheck[];
  output: string;
}

export type ValidatorFn = (result: AgentResult) => ValidationCheck[];

export interface RunOptions {
  fixture: string;
  env?: Record<string, string> | undefined;
}

export async function runAgent(agent: string, options: RunOptions): Promise<AgentResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    const child = spawn("node", ["play.ts", options.fixture], {
      cwd: actionDir,
      env: { ...process.env, AGENT_OVERRIDE: agent, ...options.env },
      stdio: "pipe",
    });

    child.stdout?.on("data", (data) => chunks.push(data));
    child.stderr?.on("data", (data) => chunks.push(data));

    child.on("close", (code) => {
      resolve({
        agent,
        success: code === 0,
        output: Buffer.concat(chunks).toString(),
      });
    });
  });
}

export function validateResult(result: AgentResult, validator: ValidatorFn): ValidationResult {
  const checks = validator(result);
  const allPassed = checks.every((c) => c.passed);

  return {
    agent: result.agent,
    passed: result.success && allPassed,
    checks,
    output: result.output,
  };
}

export async function runAllAgents(options: RunOptions): Promise<AgentResult[]> {
  return Promise.all(agents.map((agent) => runAgent(agent, options)));
}

export interface TestRunnerOptions {
  name: string;
  fixture: string;
  validator: ValidatorFn;
  env?: Record<string, string>;
}

export async function runTests(options: TestRunnerOptions): Promise<void> {
  const agentArg = process.argv[2];

  if (agentArg) {
    // single agent mode
    if (!agents.includes(agentArg as (typeof agents)[number])) {
      console.error(`unknown agent: ${agentArg}`);
      console.error(`available agents: ${agents.join(", ")}`);
      process.exit(1);
    }
    console.log(`running ${options.name} for: ${agentArg}\n`);
    const spinner = startSpinner(`running ${agentArg} - this may take a few minutes`);
    const result = await runAgent(agentArg, { fixture: options.fixture, env: options.env });
    spinner.stop();
    const validation = validateResult(result, options.validator);
    console.log(result.output);
    printSingleValidation(validation);
    process.exit(validation.passed ? 0 : 1);
  }

  // parallel mode
  console.log(`running ${options.name} for: ${agents.join(", ")}\n`);
  const spinner = startSpinner(
    `running ${agents.length} agents in parallel - this may take a few minutes`
  );

  const results = await runAllAgents({ fixture: options.fixture, env: options.env });
  spinner.stop();

  const validations = results.map((r) => validateResult(r, options.validator));

  printResults(validations);

  const failed = validations.filter((v) => !v.passed);
  if (failed.length > 0) {
    printFailedOutputs(failed);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

function printSingleValidation(validation: ValidationResult): void {
  const checksStr = validation.checks.map((c) => `${c.name}=${c.passed ? "✓" : "✗"}`).join(" ");
  console.log(`\nvalidation: ${checksStr}`);
}

function printResults(validations: ValidationResult[]): void {
  // build header from check names
  const checkNames = validations[0]?.checks.map((c) => c.name) ?? [];
  const headerCols = checkNames.map((n) => n.toUpperCase().padEnd(12)).join("");

  console.log("Results:");
  console.log("-".repeat(60));
  console.log(`STATUS  AGENT       ${headerCols}`);
  console.log("-".repeat(60));

  for (const v of validations) {
    const status = v.passed ? "✅ PASS" : "❌ FAIL";
    const checkCols = v.checks.map((c) => (c.passed ? "✓" : "✗").padEnd(12)).join("");
    console.log(`${status}  ${v.agent.padEnd(10)}  ${checkCols}`);
  }
  console.log("-".repeat(60));

  const passed = validations.filter((v) => v.passed);
  console.log(`\n${passed.length}/${validations.length} passed`);
}

function printFailedOutputs(failed: ValidationResult[]): void {
  console.log(`\nFailed agents output:\n`);
  for (const v of failed) {
    console.log(`${"=".repeat(60)}`);
    console.log(`${v.agent}`);
    console.log(`${"=".repeat(60)}`);
    console.log(v.output);
  }
}
