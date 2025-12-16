import { log } from "../utils/cli.ts";
import { installNodeDependencies } from "./installNodeDependencies.ts";
import { installPythonDependencies } from "./installPythonDependencies.ts";
import type { PrepDefinition, PrepResult } from "./types.ts";

export type { PrepResult } from "./types.ts";

// register all prep steps here
const prepSteps: PrepDefinition[] = [installNodeDependencies, installPythonDependencies];

/**
 * run all prep steps sequentially.
 * failures are logged as warnings but don't stop the run.
 */
export async function runPrepPhase(): Promise<PrepResult[]> {
  log.info("🔧 starting prep phase...");
  const startTime = Date.now();
  const results: PrepResult[] = [];

  for (const step of prepSteps) {
    const shouldRun = await step.shouldRun();
    if (!shouldRun) {
      log.info(`⏭️  skipping ${step.name} (not applicable)`);
      continue;
    }

    log.info(`▶️  running ${step.name}...`);
    const result = await step.run();
    results.push(result);

    if (result.dependenciesInstalled) {
      log.info(`✅ ${step.name}: dependencies installed`);
    } else if (result.issues.length > 0) {
      log.warning(`⚠️  ${step.name}: ${result.issues[0]}`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  log.info(`🔧 prep phase completed (${totalDurationMs}ms)`);

  return results;
}
