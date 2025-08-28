import * as core from "@actions/core";
import { createAgent } from "./agents/factory";

async function main(): Promise<void> {
  try {
    // Get inputs
    const prompt = core.getInput("prompt", { required: true });
    const anthropicApiKey = core.getInput("anthropic_api_key", { required: true });

    if (!anthropicApiKey) {
      throw new Error("anthropic_api_key is required");
    }

    core.info(`🐸 Pullfrog Claude Code Action starting...`);
    core.info(`Prompt: ${prompt}`);

    // Create and install the Claude agent
    const agent = createAgent("claude", { apiKey: anthropicApiKey });
    await agent.install();

    // Execute the agent with the prompt
    const result = await agent.execute(prompt);

    if (!result.success) {
      throw new Error(result.error || "Agent execution failed");
    }

    // Set outputs
    core.setOutput("status", "success");
    core.setOutput("prompt", prompt);
    core.setOutput("output", result.output || "");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

// Execute main function
main();
