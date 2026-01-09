#!/usr/bin/env node
/**
 * Landlock sandbox e2e test.
 * Proves that Landlock correctly blocks writes to the working directory
 * while allowing writes to /tmp and other system paths.
 *
 * Run inside Docker:
 *   docker run --rm --cap-add SYS_ADMIN --security-opt seccomp:unconfined \
 *     -v "$(pwd):/app/action" -w /app/action node:24 node test-landlock.ts
 *
 * Or via pnpm:
 *   pnpm test:landlock
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean | string): void {
  try {
    const result = fn();
    if (result === true) {
      results.push({ name, passed: true, message: "OK" });
      console.log(`  ✓ ${name}`);
    } else if (typeof result === "string") {
      results.push({ name, passed: false, message: result });
      console.log(`  ✗ ${name}: ${result}`);
    } else {
      results.push({ name, passed: false, message: "returned false" });
      console.log(`  ✗ ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, message: msg });
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Landlock Sandbox E2E Test");
  console.log("=".repeat(60));
  console.log();

  // Load native addon
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);

  let addon: {
    isLandlockSupported(): { supported: boolean; reason?: string };
    applySandbox(config: { readonly: boolean; network: boolean }, workingDir: string): void;
  };

  try {
    const addonPath = join(__dirname, "sandbox", "pullfrog-sandbox.linux-x64-gnu.node");
    addon = require(addonPath);
  } catch (e) {
    console.log("ERROR: Could not load native addon.");
    console.log("Make sure you're running on Linux and the addon is built.");
    console.log(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  // Check support
  console.log("1. Checking Landlock support...");
  const support = addon.isLandlockSupported();
  if (!support.supported) {
    console.log(`   Landlock not supported: ${support.reason}`);
    console.log("   This test requires a Linux kernel with Landlock enabled.");
    process.exit(1);
  }
  console.log("   ✓ Landlock supported\n");

  // Set up test directory - use a path NOT under /tmp (since /tmp is allowed)
  // We use a subdirectory of the action directory which is the mounted volume
  const testDir = join(__dirname, ".landlock-test-repo");

  // Clean up from previous runs (before sandbox is applied)
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "existing-file.txt"), "created before sandbox");

  console.log("2. Applying sandbox...");
  console.log(`   Protected directory: ${testDir}`);
  addon.applySandbox({ readonly: true, network: true }, testDir);
  console.log("   ✓ Sandbox applied\n");

  console.log("3. Running tests...\n");

  // Test: Write to working dir blocked
  test("Write to protected dir is blocked", () => {
    try {
      writeFileSync(join(testDir, "blocked.txt"), "should fail");
      return "Write succeeded but should have been blocked";
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "EACCES") {
        return true;
      }
      return `Unexpected error: ${(e as Error).message}`;
    }
  });

  // Test: Write to /tmp allowed
  test("Write to /tmp is allowed", () => {
    try {
      writeFileSync("/tmp/landlock-test-allowed.txt", "should work");
      return true;
    } catch (e: unknown) {
      return `Write failed: ${(e as Error).message}`;
    }
  });

  // Test: Read from working dir works
  test("Read from protected dir works", () => {
    try {
      const content = readFileSync(join(testDir, "existing-file.txt"), "utf8");
      if (content === "created before sandbox") {
        return true;
      }
      return `Unexpected content: ${content}`;
    } catch (e: unknown) {
      return `Read failed: ${(e as Error).message}`;
    }
  });

  // Test: Spawn child process works
  test("Spawning child processes works", () => {
    const result = spawnSync("node", ["-e", 'console.log("ok")'], { encoding: "utf8" });
    if (result.status === 0 && result.stdout?.trim() === "ok") {
      return true;
    }
    return `Spawn failed: ${result.stderr || result.error?.message}`;
  });

  // Test: Child process inherits restrictions
  test("Child process cannot write to protected dir", () => {
    const script = `require("fs").writeFileSync("${join(testDir, "child-blocked.txt")}", "test")`;
    const result = spawnSync("node", ["-e", script], { encoding: "utf8" });
    if (result.status !== 0) {
      return true;
    }
    return "Child write succeeded but should have been blocked";
  });

  // Test: Child process can write to /tmp
  test("Child process can write to /tmp", () => {
    const script = 'require("fs").writeFileSync("/tmp/child-allowed.txt", "test"); console.log("ok")';
    const result = spawnSync("node", ["-e", script], { encoding: "utf8" });
    if (result.status === 0) {
      return true;
    }
    return `Child /tmp write failed: ${result.stderr}`;
  });

  // Test: Write to /root allowed (for agent configs in Docker)
  test("Write to /root is allowed (for agent configs)", () => {
    const homeDir = "/root";
    const testFile = join(homeDir, ".landlock-test-config");
    try {
      writeFileSync(testFile, "test config");
      rmSync(testFile);
      return true;
    } catch (e: unknown) {
      return `Write to ${homeDir} failed: ${(e as Error).message}`;
    }
  });

  // Test: Mkdir in working dir blocked
  test("Creating directories in protected dir is blocked", () => {
    try {
      mkdirSync(join(testDir, "blocked-dir"));
      return "Mkdir succeeded but should have been blocked";
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "EACCES") {
        return true;
      }
      return `Unexpected error: ${(e as Error).message}`;
    }
  });

  // Summary
  console.log("\n" + "=".repeat(60));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`  Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(60));

  if (passed === total) {
    console.log("\n✓ LANDLOCK SANDBOX WORKING CORRECTLY");
    console.log("  - Writes to protected directory: BLOCKED");
    console.log("  - Writes to /tmp: ALLOWED");
    console.log("  - Writes to /root: ALLOWED");
    console.log("  - Child processes: INHERIT RESTRICTIONS");
    console.log("\nNote: Test directory cannot be cleaned up (blocked by sandbox) - this is expected.");
    process.exit(0);
  } else {
    console.log("\n✗ SOME TESTS FAILED");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.message}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
