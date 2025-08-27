import * as core from "@actions/core";

//#region index.ts
try {
	const message = core.getInput("message") || "Hello from Pullfrog Action!";
	console.log(`🐸 ${message}`);
	core.info(`Action executed successfully: ${message}`);
	core.setOutput("message", message);
} catch (error) {
	const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
	core.setFailed(`Action failed: ${errorMessage}`);
}

//#endregion
