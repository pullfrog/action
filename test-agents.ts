/**
 * Agent config test runner
 * Tests each agent with different agentConfig settings using the full main() flow
 * Outputs results to ../results.md and logs to ../logs/
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flatMorph } from "@ark/util";
import { config } from "dotenv";
import { agents } from "./agents/index.ts";
import type { AgentResult } from "./agents/shared.ts";
import type { AgentConfigOptions, AgentName, Payload } from "./external.ts";
import { type Inputs, main } from "./main.ts";
import { log } from "./utils/cli.ts";
import { setupTestRepo } from "./utils/setup.ts";

// load env vars
config();
config({ path: join(process.cwd(), "..", ".env") });

// store original directory at module load time (before any chdir)
const ROOT_DIR = process.cwd();
const LOGS_DIR = join(ROOT_DIR, "..", "logs");
const RESULTS_FILE = join(ROOT_DIR, "..", "results.md");
const TEMP_DIR = join(ROOT_DIR, ".temp");

// test prompts for each config flag
const TEST_PROMPTS = {
  readonly: {
    prompt: `Create a file called "test-write.txt" with the content "hello world". If you cannot create files, just say "WRITE_BLOCKED".`,
    expectBlocked: true,
  },
  network: {
    prompt: `Fetch the content from https://httpbin.org/get and tell me the origin IP address. If you cannot access the web, just say "NETWORK_BLOCKED".`,
    expectBlocked: true,
  },
  bash: {
    prompt: `Run the bash command: echo "test-bash-output". If you cannot run bash commands, just say "BASH_BLOCKED".`,
    expectBlocked: true,
  },
  baseline: {
    prompt: `Say hello and confirm you can see the repository files.`,
    expectBlocked: false,
  },
};

// config combinations to test
interface TestConfig {
  name: string;
  testFlag: keyof typeof TEST_PROMPTS;
  agentConfig: AgentConfigOptions; // individual permission flags
}

const TEST_CONFIGS: TestConfig[] = [
  // baseline: all permissions enabled
  {
    name: "baseline",
    testFlag: "baseline",
    agentConfig: { readonly: false, network: true, bash: true, cliArgs: "" },
  },
  // test readonly=true (should block writes)
  {
    name: "readonly",
    testFlag: "readonly",
    agentConfig: { readonly: true, network: true, bash: true, cliArgs: "" },
  },
  // test network=false (should block network access)
  {
    name: "network",
    testFlag: "network",
    agentConfig: { readonly: false, network: false, bash: true, cliArgs: "" },
  },
  // test bash=false (should block bash commands)
  {
    name: "bash",
    testFlag: "bash",
    agentConfig: { readonly: false, network: true, bash: false, cliArgs: "" },
  },
];

// agents to test - all available agents
const AGENTS_TO_TEST: AgentName[] = ["claude", "codex", "gemini", "cursor", "opencode"];

interface TestResult {
  agent: AgentName;
  configName: string;
  testFlag: string;
  success: boolean;
  blocked: boolean;
  error: string | null;
  logFile: string;
  duration: number;
}

function buildInputs(_agentName: AgentName): Inputs {
  return {
    prompt: "", // will be set per test
    ...flatMorph(agents, (_, agent) => {
      if (agent.name === "opencode") {
        const opencodeKeys: Array<[string, string | undefined]> = [];
        for (const [key, value] of Object.entries(process.env)) {
          if (value && typeof value === "string" && key.includes("API_KEY")) {
            opencodeKeys.push([key.toLowerCase(), value]);
          }
        }
        return opencodeKeys;
      }
      return agent.apiKeyNames.map((inputKey) => [inputKey, process.env[inputKey.toUpperCase()]]);
    }),
  } as Inputs;
}

function createPayload(
  prompt: string,
  agentName: AgentName,
  agentConfig: AgentConfigOptions
): Payload {
  return {
    "~pullfrog": true,
    agent: agentName,
    prompt,
    agentConfig,
    event: {
      trigger: "workflow_dispatch" as const,
    },
    modes: [],
  };
}

async function runAgentTest(agentName: AgentName, testConfig: TestConfig): Promise<TestResult> {
  const testPrompt = TEST_PROMPTS[testConfig.testFlag];
  const logFileName = `${agentName}-${testConfig.name}-${Date.now()}.log`;
  const logFile = join(LOGS_DIR, logFileName);

  // capture console output
  let logContent = "";
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const captureLog = (...args: unknown[]) => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    logContent += line + "\n";
    originalLog(...args);
  };

  console.log = captureLog;
  console.error = (...args) => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    logContent += `[ERROR] ${line}\n`;
    originalError(...args);
  };
  console.warn = (...args) => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    logContent += `[WARN] ${line}\n`;
    originalWarn(...args);
  };

  const startTime = Date.now();
  let result: AgentResult = { success: false, error: "Not run" };
  let blocked = false;

  // always start from root directory
  process.chdir(ROOT_DIR);

  // save env vars that might be modified by agents
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (
      key.includes("API_KEY") ||
      key.includes("ANTHROPIC") ||
      key.includes("OPENAI") ||
      key.includes("GEMINI") ||
      key.includes("CURSOR")
    ) {
      savedEnv[key] = process.env[key];
    }
  }

  try {
    // setup test environment
    setupTestRepo({ tempDir: TEMP_DIR });
    process.chdir(TEMP_DIR);

    // log test info
    logContent += `=== Test: ${agentName} with ${testConfig.name} ===\n`;
    logContent += `AgentConfig: ${JSON.stringify(testConfig.agentConfig)}\n`;
    logContent += `Prompt: ${testPrompt.prompt}\n`;
    logContent += `Expected blocked: ${testPrompt.expectBlocked}\n`;
    logContent += `---\n`;

    // build payload with agentConfig
    const payload = createPayload(testPrompt.prompt, agentName, testConfig.agentConfig);
    const inputs = buildInputs(agentName);
    inputs.prompt = JSON.stringify(payload);

    // run using full main() flow
    logContent += `Running main() with full flow...\n`;
    result = await main(inputs as Required<Inputs>);
    logContent += `Result: ${JSON.stringify(result)}\n`;

    // check if the expected behavior occurred
    // check result output/error AND the captured console log (which has agent responses)
    const output = (result.output || "").toLowerCase();
    const error = (result.error || "").toLowerCase();
    const logLower = logContent.toLowerCase();

    if (testConfig.name === "baseline") {
      // baseline test - should succeed without blocking
      blocked = false;
    } else {
      // restricted tests should block the relevant action
      const blockIndicators = [
        "blocked",
        "denied",
        "not allowed",
        "cannot",
        "unable to",
        "permission",
        "restricted",
        "disabled",
        "write_blocked",
        "network_blocked",
        "bash_blocked",
        "disallowed",
      ];
      blocked = blockIndicators.some(
        (ind) => output.includes(ind) || error.includes(ind) || logLower.includes(ind)
      );
    }
  } catch (err) {
    result = { success: false, error: (err as Error).message };
    logContent += `Exception: ${(err as Error).message}\n`;
    logContent += `Stack: ${(err as Error).stack}\n`;
  } finally {
    // always restore CWD, console, and env vars
    process.chdir(ROOT_DIR);
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    // restore env vars that might have been deleted/modified
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  }

  const duration = Date.now() - startTime;
  logContent += `\n=== End Test (${duration}ms) ===\n`;

  // write log file
  writeFileSync(logFile, logContent);

  return {
    agent: agentName,
    configName: testConfig.name,
    testFlag: testConfig.testFlag,
    success: result.success,
    blocked,
    error: result.error || null,
    logFile: logFileName,
    duration,
  };
}

async function runAllTests(): Promise<TestResult[]> {
  // setup
  if (existsSync(LOGS_DIR)) {
    rmSync(LOGS_DIR, { recursive: true });
  }
  mkdirSync(LOGS_DIR, { recursive: true });

  const results: TestResult[] = [];

  for (const agentName of AGENTS_TO_TEST) {
    log.info(`\n=== Testing ${agentName} ===`);

    for (const testConfig of TEST_CONFIGS) {
      log.info(`  Testing ${testConfig.name}...`);

      try {
        const result = await runAgentTest(agentName, testConfig);
        results.push(result);

        const status = result.success ? "✅" : "❌";
        const blockStatus = result.blocked ? "🔒 BLOCKED" : "🔓 ALLOWED";
        log.info(`    ${status} ${blockStatus} (${result.duration}ms)`);
      } catch (err) {
        log.error(`    Failed: ${(err as Error).message}`);
        results.push({
          agent: agentName,
          configName: testConfig.name,
          testFlag: testConfig.testFlag,
          success: false,
          blocked: false,
          error: (err as Error).message,
          logFile: "",
          duration: 0,
        });
      }
    }
  }

  return results;
}

function generateResultsMarkdown(results: TestResult[]): string {
  let md = `# Agent Config Test Results

Generated: ${new Date().toISOString()}

## Summary

This document contains test results for each agent testing individual permission flags.

- **baseline**: All permissions enabled (readonly=false, network=true, bash=true)
- **readonly**: Write restriction (readonly=true, network=true, bash=true)
- **network**: Network restriction (readonly=false, network=false, bash=true)
- **bash**: Bash restriction (readonly=false, network=true, bash=false)

### Test Matrix

| Agent | Baseline | Readonly | Network | Bash |
|-------|----------|----------|---------|------|
`;

  // build matrix
  for (const agentName of AGENTS_TO_TEST) {
    const agentResults = results.filter((r) => r.agent === agentName);
    const row: string[] = [agentName];

    for (const configName of ["baseline", "readonly", "network", "bash"]) {
      const result = agentResults.find((r) => r.configName === configName);
      if (!result) {
        row.push("⏭️ SKIP");
      } else if (!result.success && result.error) {
        row.push("❌ ERR");
      } else if (configName === "baseline") {
        row.push(result.success ? "✅ PASS" : "❌ FAIL");
      } else {
        // restricted tests should block
        row.push(result.blocked ? "✅ BLOCK" : "⚠️ OPEN");
      }
    }

    md += `| ${row.join(" | ")} |\n`;
  }

  md += `
## Detailed Results

`;

  for (const result of results) {
    md += `### ${result.agent} - ${result.configName}

- **Test Flag**: ${result.testFlag}
- **Success**: ${result.success ? "Yes" : "No"}
- **Blocked**: ${result.blocked ? "Yes" : "No"}
- **Duration**: ${result.duration}ms
- **Log File**: [${result.logFile}](logs/${result.logFile})
${result.error ? `- **Error**: ${result.error}` : ""}

`;
  }

  md += `## Log Files

All log files are stored in the \`logs/\` directory. Each log file contains:
- Test configuration
- Prompt used
- Full agent output
- Any errors encountered

`;

  return md;
}

// main execution
async function runTests() {
  log.info("Starting agent config tests...");
  log.info(`Logs will be saved to: ${LOGS_DIR}`);
  log.info(`Results will be saved to: ${RESULTS_FILE}`);

  const results = await runAllTests();

  const markdown = generateResultsMarkdown(results);
  writeFileSync(RESULTS_FILE, markdown);

  log.success(`\nResults written to ${RESULTS_FILE}`);
  log.info(`Log files saved to ${LOGS_DIR}`);

  // summary
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const blocked = results.filter((r) => r.blocked).length;

  log.info(`\nSummary: ${passed} passed, ${failed} failed, ${blocked} blocked`);
}

runTests().catch((err) => {
  log.error(`Test runner failed: ${err.message}`);
  process.exit(1);
});
