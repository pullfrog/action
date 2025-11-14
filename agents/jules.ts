import { log } from "../utils/cli.ts";
import { parseRepoContext } from "../utils/github.ts";
import { spawn } from "../utils/subprocess.ts";
import { addInstructions } from "./instructions.ts";
import { agent, installFromNpmTarball } from "./shared.ts";

export const jules = agent({
  name: "jules",
  inputKey: "google_api_key",
  install: async () => {
    return await installFromNpmTarball({
      packageName: "@google/jules",
      version: "latest",
      executablePath: "run.cjs",
    });
  },
  run: async ({
    prompt,
    apiKey,
    mcpServers: _mcpServers,
    githubInstallationToken: _githubInstallationToken,
    cliPath,
  }) => {
    if (!apiKey) {
      throw new Error("google_api_key is required for jules agent");
    }

    const repoContext = parseRepoContext();
    const repoName = `${repoContext.owner}/${repoContext.name}`;

    log.info(`Creating Jules session for ${repoName}...`);

    // Set API key as environment variable for CLI authentication
    // Note: The CLI may require browser-based auth via 'jules login' in interactive mode
    // In CI, we rely on the API key being set as an environment variable
    const env: Record<string, string> = {
      GOOGLE_API_KEY: apiKey,
      JULES_API_KEY: apiKey,
    };
    // Copy over existing env vars, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Create a new remote session
    const sessionPrompt = addInstructions(prompt);
    log.info(`Starting session with prompt: ${prompt.substring(0, 100)}...`);

    let sessionId: string | undefined;
    try {
      const createResult = await spawn({
        cmd: "node",
        args: [cliPath, "remote", "new", "--repo", repoName, "--session", sessionPrompt],
        env,
        onStdout: (chunk) => {
          log.info(chunk.trim());
          // Try to extract session ID from output
          const match = chunk.match(/session[:\s]+(\d+)/i) || chunk.match(/id[:\s]+(\d+)/i);
          if (match && !sessionId) {
            sessionId = match[1];
            log.info(`✓ Session ID: ${sessionId}`);
          }
        },
        onStderr: (chunk) => {
          log.warning(chunk.trim());
        },
      });

      if (createResult.exitCode !== 0) {
        throw new Error(
          `Failed to create Jules session: ${createResult.stderr || createResult.stdout || "Unknown error"}`
        );
      }

      // If session ID wasn't extracted from stdout, try to parse it
      if (!sessionId) {
        const output = createResult.stdout + createResult.stderr;
        const match = output.match(/session[:\s]+(\d+)/i) || output.match(/id[:\s]+(\d+)/i);
        if (match) {
          sessionId = match[1];
        }
      }

      if (!sessionId) {
        log.warning("Could not extract session ID from output. Session may have been created.");
        log.info(`Output: ${createResult.stdout}`);
      } else {
        log.info(`✓ Session created: ${sessionId}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to create Jules session: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        output: "",
      };
    }

    // Monitor session progress by polling session list
    log.info("Monitoring session progress...");
    let finalOutput = "";
    const maxPollAttempts = 300; // ~50 minutes max (10 second intervals)
    let pollAttempts = 0;

    while (pollAttempts < maxPollAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds between polls
      pollAttempts++;

      try {
        // List sessions to check status
        const listResult = await spawn({
          cmd: "node",
          args: [cliPath, "remote", "list", "--session"],
          env,
          onStdout: (chunk) => {
            // Log session updates
            const trimmed = chunk.trim();
            if (trimmed) {
              log.info(trimmed);
            }
          },
        });

        if (listResult.exitCode === 0) {
          const output = listResult.stdout;
          // Check if our session is complete
          // The CLI output format may vary, so we look for completion indicators
          if (sessionId && output.includes(sessionId)) {
            // Try to determine if session is complete
            // This is a heuristic - the actual output format may differ
            if (
              output.includes("completed") ||
              output.includes("done") ||
              output.includes("finished")
            ) {
              log.info("Session appears to be completed");
              finalOutput = "Session completed. Pulling results...";
              break;
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warning(`Error checking session status: ${errorMessage}`);
      }
    }

    // Pull results if session ID is available
    if (sessionId) {
      try {
        log.info(`Pulling results for session ${sessionId}...`);
        const pullResult = await spawn({
          cmd: "node",
          args: [cliPath, "remote", "pull", "--session", sessionId],
          env,
          onStdout: (chunk) => {
            log.info(chunk.trim());
          },
          onStderr: (chunk) => {
            log.warning(chunk.trim());
          },
        });

        if (pullResult.exitCode === 0) {
          finalOutput = pullResult.stdout || "Results pulled successfully.";
        } else {
          log.warning(`Failed to pull results: ${pullResult.stderr || pullResult.stdout}`);
          finalOutput = finalOutput || "Session completed. Check Jules dashboard for results.";
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warning(`Error pulling results: ${errorMessage}`);
      }
    }

    if (pollAttempts >= maxPollAttempts) {
      log.warning("Session monitoring timeout reached. Session may still be in progress.");
      finalOutput =
        finalOutput || "Session monitoring timeout. Check Jules dashboard for session status.";
    }

    return {
      success: true,
      output: finalOutput || "Jules session completed. Check the Jules dashboard for results.",
    };
  },
});
