#!/usr/bin/env node

/**
 * entry point for get-installation-token action.
 * handles both main and post execution using the isPost state pattern.
 */

import * as core from "@actions/core";
import { acquireInstallationToken, revokeInstallationToken } from "./token.ts";

const STATE_TOKEN = "token";
const STATE_IS_POST = "isPost";

async function main(): Promise<void> {
  core.saveState(STATE_IS_POST, "true");

  const reposInput = core.getInput("repos");
  const additionalRepos = reposInput
    ? reposInput
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  const token = await acquireInstallationToken({ repos: additionalRepos });

  // mask the token in logs
  core.setSecret(token);

  // save token to state for post cleanup
  core.saveState(STATE_TOKEN, token);

  // set as output
  core.setOutput("token", token);

  const scope = additionalRepos.length
    ? `current repo + ${additionalRepos.join(", ")}`
    : "current repo only";
  core.info(`» installation token acquired (${scope})`);
}

async function post(): Promise<void> {
  const token = core.getState(STATE_TOKEN);

  if (!token) {
    core.debug("no token found in state, skipping revocation");
    return;
  }

  await revokeInstallationToken(token);
  core.info("» installation token revoked");
}

async function run(): Promise<void> {
  try {
    const isPost = core.getState(STATE_IS_POST) === "true";

    if (isPost) {
      await post();
    } else {
      await main();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

await run();
