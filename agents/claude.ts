import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { log } from "../utils/cli.ts";
import { type Agent, instructions } from "./shared.ts";

export const claude: Agent = {
  run: async ({ prompt, mcpServers, apiKey }) => {
    process.env.ANTHROPIC_API_KEY = apiKey;

    const queryInstance = query({
      prompt: `${instructions}\n\n${prompt}`,
      options: {
        permissionMode: "bypassPermissions",
        mcpServers,
      },
    });

    // Stream the results
    for await (const message of queryInstance) {
      const handler = messageHandlers[message.type];
      await handler(message as never);
    }

    return {
      success: true,
      output: "",
    };
  },
};

type SDKMessageType = SDKMessage["type"];

type SDKMessageHandler<type extends SDKMessageType = SDKMessageType> = (
  data: Extract<SDKMessage, { type: type }>
) => void | Promise<void>;

type SDKMessageHandlers = {
  [type in SDKMessageType]: SDKMessageHandler<type>;
};

// Track bash tool IDs to identify when bash tool results come back
const bashToolIds = new Set<string>();

const messageHandlers: SDKMessageHandlers = {
  assistant: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "text" && content.text?.trim()) {
          log.box(content.text.trim(), { title: "Claude" });
        } else if (content.type === "tool_use") {
          log.info(`→ ${content.name}`);

          // Track bash tool IDs
          if (content.name === "bash" && content.id) {
            bashToolIds.add(content.id);
          }

          if (content.input) {
            const input = content.input as any;
            if (input.description) log.info(`   └─ ${input.description}`);
            if (input.command) log.info(`   └─ command: ${input.command}`);
            if (input.file_path) log.info(`   └─ file: ${input.file_path}`);
            if (input.content) {
              const preview =
                input.content.length > 100
                  ? `${input.content.substring(0, 100)}...`
                  : input.content;
              log.info(`   └─ content: ${preview}`);
            }
            if (input.query) log.info(`   └─ query: ${input.query}`);
            if (input.pattern) log.info(`   └─ pattern: ${input.pattern}`);
            if (input.url) log.info(`   └─ url: ${input.url}`);
            if (input.edits && Array.isArray(input.edits)) {
              log.info(`   └─ edits: ${input.edits.length} changes`);
              input.edits.forEach((edit: any, index: number) => {
                if (edit.file_path) log.info(`      ${index + 1}. ${edit.file_path}`);
              });
            }
            if (input.task) log.info(`   └─ task: ${input.task}`);
            if (input.bash_command) log.info(`   └─ bash_command: ${input.bash_command}`);
          }
        }
      }
    }
  },
  user: (data) => {
    if (data.message?.content) {
      for (const content of data.message.content) {
        if (content.type === "tool_result") {
          const toolUseId = (content as any).tool_use_id;
          const isBashTool = toolUseId && bashToolIds.has(toolUseId);

          if (isBashTool) {
            // Log bash output in a collapsed group
            const outputContent =
              typeof content.content === "string"
                ? content.content
                : Array.isArray(content.content)
                  ? content.content
                      .map((c: any) => (typeof c === "string" ? c : c.text || JSON.stringify(c)))
                      .join("\n")
                  : String(content.content);

            log.startGroup(`bash output`);
            if (content.is_error) {
              log.warning(outputContent);
            } else {
              log.info(outputContent);
            }
            log.endGroup();
            // Clean up the tracked ID
            bashToolIds.delete(toolUseId);
          } else if (content.is_error) {
            const errorContent =
              typeof content.content === "string" ? content.content : String(content.content);
            log.warning(`Tool error: ${errorContent}`);
          }
        }
      }
    }
  },
  result: async (data) => {
    if (data.subtype === "success") {
      await log.summaryTable([
        [
          { data: "Cost", header: true },
          { data: "Input Tokens", header: true },
          { data: "Output Tokens", header: true },
        ],
        [
          `$${data.total_cost_usd?.toFixed(4) || "0.0000"}`,
          String(data.usage?.input_tokens || 0),
          String(data.usage?.output_tokens || 0),
        ],
      ]);
    } else if (data.subtype === "error_max_turns") {
      log.error(`Max turns reached: ${JSON.stringify(data)}`);
    } else if (data.subtype === "error_during_execution") {
      log.error(`Execution error: ${JSON.stringify(data)}`);
    } else {
      log.error(`Failed: ${JSON.stringify(data)}`);
    }
  },
  system: () => {},
  stream_event: () => {},
  tool_progress: () => {},
  auth_status: () => {},
};
