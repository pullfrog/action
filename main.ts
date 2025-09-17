import * as core from "@actions/core";
import { ClaudeAgent } from "./agents/claude.ts";
import { parseGitHubContext, type MockGitHubContext } from "./github/context.ts";
import { detectMode, getModeDescription } from "./github/modes.ts";
import { enhancePromptWithContext, extractTriggerPrompt } from "./github/prompt-enhancer.ts";

// Expected environment variables that should be passed as inputs
export const EXPECTED_INPUTS: string[] = [
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_INSTALLATION_TOKEN",
];

export interface ExecutionInputs {
  prompt: string;
  anthropic_api_key: string;
  github_token?: string;
  github_installation_token?: string;
  trigger_phrase?: string;
}

export interface EnhancedMainParams extends MainParams {
  mockContext?: MockGitHubContext;
}

export interface MainParams {
  inputs: ExecutionInputs;
  env: Record<string, string>;
  cwd: string;
}

export interface MainResult {
  success: boolean;
  output?: string | undefined;
  error?: string | undefined;
}

export async function main(params: MainParams | EnhancedMainParams): Promise<MainResult> {
  try {
    // Extract inputs from params
    const { inputs, env, cwd } = params;
    const mockContext = (params as EnhancedMainParams).mockContext;

    // Set working directory if different from current
    if (cwd !== process.cwd()) {
      process.chdir(cwd);
    }

    // Set environment variables
    Object.assign(process.env, env);

    // Parse GitHub context to understand the event type and context
    const context = parseGitHubContext(mockContext);
    const mode = detectMode(context);
    
    core.info(`→ GitHub Event: ${context.eventName}`);
    core.info(`→ Mode: ${mode} (${getModeDescription(mode)})`);
    core.info(`→ Repository: ${context.repository.full_name}`);
    core.info(`→ Actor: ${context.actor}`);
    
    // Determine the effective prompt based on mode and context
    let effectivePrompt = inputs.prompt;
    
    if (mode === "tag") {
      // Extract prompt from GitHub context (comment/issue body)
      const extractedPrompt = extractTriggerPrompt(context);
      if (extractedPrompt) {
        effectivePrompt = extractedPrompt;
        core.info(`→ Extracted prompt from ${context.eventName}: ${extractedPrompt.substring(0, 100)}...`);
      } else {
        core.info(`→ No trigger phrase found, skipping execution`);
        return {
          success: true,
          output: "No trigger phrase found in the context",
        };
      }
    }
    
    if (!effectivePrompt?.trim()) {
      core.info(`→ No prompt provided, skipping execution`);
      return {
        success: true,
        output: "No prompt provided",
      };
    }
    
    // Enhance prompt with GitHub context
    const enhanced = enhancePromptWithContext(effectivePrompt, context);
    
    core.info(`→ Enhanced prompt with ${context.eventName} context`);
    core.info(`→ Starting Claude Code execution`);

    // Create and install the Claude agent
    const agent = new ClaudeAgent({ apiKey: inputs.anthropic_api_key });
    await agent.install();

    // Execute the agent with the enhanced prompt
    const result = await agent.execute(enhanced.contextualPrompt);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Agent execution failed",
        output: result.output!,
      };
    }

    return {
      success: true,
      output: result.output || "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: errorMessage,
    };
  }
}
