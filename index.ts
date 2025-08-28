import * as core from "@actions/core";

try {
  // Get the message input parameter, with a default fallback
  const message = core.getInput("message") || "Hello from Pullfrog Action!";

  // Print the message to console and GitHub Actions logs
  console.log(`🐸 Pullfrog says: ${message}`);
  core.info(`Action executed successfully with message: ${message}`);

  // Set an output for potential use by other actions
  core.setOutput("message", message);
} catch (error) {
  // Handle any errors and fail the action
  const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
  core.setFailed(`Action failed: ${errorMessage}`);
}
