/**
 * Centralized debug logging utility
 * Controls debug behavior based on LOG_LEVEL environment variable
 */

import * as core from "@actions/core";

const isDebugEnabled = process.env.LOG_LEVEL === "debug";
const isGitHubActions = !!process.env.GITHUB_ACTIONS;

/**
 * Check if debug logging is enabled
 */
export function isDebug(): boolean {
  return isDebugEnabled;
}

/**
 * Log debug message if debug is enabled
 * Uses core.debug() in GitHub Actions, console.log() locally
 */
export function debugLog(message: string): void {
  if (isDebugEnabled) {
    if (isGitHubActions) {
      core.debug(message);
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}