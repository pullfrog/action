import * as core from "@actions/core";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createMcpConfig } from "../mcp/config.ts";
import { debugLog, isDebug } from "../utils/logging.ts";
import { boxString, tableString } from "../utils/table.ts";
import { instructions } from "./shared.ts";
import type { Agent, AgentConfig, AgentResult } from "./types.ts";

/**
 * Claude Code agent implementation
 */
export class ClaudeAgent implements Agent {
  private apiKey: string;
  private githubInstallationToken: string;

  constructor(config: AgentConfig) {
    this.apiKey = config.apiKey;
    this.githubInstallationToken = config.githubInstallationToken;
  }

  /**
   * Install is a no-op since Claude CLI is bundled with the SDK
   */
  async install(): Promise<void> {
    // No installation needed - CLI is bundled with @anthropic-ai/claude-agent-sdk
  }

  /**
   * Execute Claude Code with the given prompt using the SDK
   */
  async execute(prompt: string): Promise<AgentResult> {
    core.info("Running Claude Agent SDK...");

    console.log(boxString(prompt, { title: "Prompt" }));

    const mcpConfig = JSON.parse(createMcpConfig(this.githubInstallationToken));

    if (isDebug()) {
      debugLog(`📋 MCP Config: ${JSON.stringify(mcpConfig, null, 2)}`);
    }

    core.startGroup("🔄 Run details");

    // Initialize session
    core.info(`🚀 Starting Claude Agent SDK session...`);

    // Set API key environment variable for SDK
    process.env.ANTHROPIC_API_KEY = this.apiKey;

    // Create the query with SDK options
    const queryInstance = query({
      prompt: `${instructions}\n\n${prompt}`,
      options: {
        permissionMode: "bypassPermissions",
        mcpServers: mcpConfig.mcpServers,
      },
    });

    // Stream the results
    for await (const message of queryInstance) {
      const handler = messageHandlers[message.type];
      handler(message as never);
    }

    core.info("✅ Task complete.");
    core.endGroup();

    return {
      success: true,
      output: "",
    };
  }
}

type SDKMessageType = SDKMessage["type"];

type SDKMessageHandler<type extends SDKMessageType = SDKMessageType> = (
  data: Extract<SDKMessage, { type: type }>
) => void;

type SDKMessageHandlers = {
  [type in SDKMessageType]: SDKMessageHandler<type>;
};

const messageHandlers: SDKMessageHandlers = {
  assistant: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "text" && content.text?.trim()) {
          core.info(boxString(content.text.trim(), { title: "Claude" }));
        } else if (content.type === "tool_use") {
          core.info(`→ ${content.name}`);

          if (content.input) {
            const input = content.input as any;
            if (input.description) core.info(`   └─ ${input.description}`);
            if (input.command) core.info(`   └─ command: ${input.command}`);
            if (input.file_path) core.info(`   └─ file: ${input.file_path}`);
            if (input.content) {
              const preview =
                input.content.length > 100
                  ? `${input.content.substring(0, 100)}...`
                  : input.content;
              core.info(`   └─ content: ${preview}`);
            }
            if (input.query) core.info(`   └─ query: ${input.query}`);
            if (input.pattern) core.info(`   └─ pattern: ${input.pattern}`);
            if (input.url) core.info(`   └─ url: ${input.url}`);
            if (input.edits && Array.isArray(input.edits)) {
              core.info(`   └─ edits: ${input.edits.length} changes`);
              input.edits.forEach((edit: any, index: number) => {
                if (edit.file_path) core.info(`      ${index + 1}. ${edit.file_path}`);
              });
            }
            if (input.task) core.info(`   └─ task: ${input.task}`);
            if (input.bash_command) core.info(`   └─ bash_command: ${input.bash_command}`);
          }
        }
      }
    }
  },
  user: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "tool_result" && content.is_error) {
          core.warning(`❌ Tool error: ${content.content}`);
        }
      }
    }
  },
  result: (data) => {
    if (data.subtype === "success") {
      core.info(
        tableString([
          ["Cost", `$${data.total_cost_usd?.toFixed(4) || "0.0000"}`],
          ["Input Tokens", data.usage?.input_tokens || 0],
          ["Output Tokens", data.usage?.output_tokens || 0],
        ])
      );
    } else if (data.subtype === "error_max_turns") {
      core.error(`❌ Max turns reached: ${JSON.stringify(data)}`);
    } else if (data.subtype === "error_during_execution") {
      core.error(`❌ Execution error: ${JSON.stringify(data)}`);
    } else {
      core.error(`❌ Failed: ${JSON.stringify(data)}`);
    }
  },
  system: () => {},
  stream_event: () => {},
};
