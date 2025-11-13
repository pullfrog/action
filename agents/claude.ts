import { execSync } from "node:child_process";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pipeline } from "node:stream/promises";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import packageJson from "../package.json" with { type: "json" };
import { log } from "../utils/cli.ts";
import { agent, instructions } from "./shared.ts";

export const claude = agent({
  name: "claude",
  inputKey: "anthropic_api_key",
  install: async () => {
    // Get the SDK version from package.json and resolve to actual version
    const versionRange = packageJson.dependencies["@anthropic-ai/claude-agent-sdk"] || "latest";
    let sdkVersion: string;

    // If it's a range (starts with ^ or ~), query npm registry for the latest matching version
    if (versionRange.startsWith("^") || versionRange.startsWith("~")) {
      const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
      log.info(`Resolving version for range ${versionRange}...`);
      try {
        const registryResponse = await fetch(`${npmRegistry}/@anthropic-ai/claude-agent-sdk`);
        if (!registryResponse.ok) {
          throw new Error(`Failed to query registry: ${registryResponse.status}`);
        }
        const registryData = (await registryResponse.json()) as {
          "dist-tags": { latest: string };
          versions: Record<string, unknown>;
        };
        // Get the latest version that matches the range (simplified: just use latest)
        sdkVersion = registryData["dist-tags"].latest;
        log.info(`Resolved to version ${sdkVersion}`);
      } catch (error) {
        log.warning(
          `Failed to resolve version from registry, using latest: ${error instanceof Error ? error.message : String(error)}`
        );
        sdkVersion = "latest";
      }
    } else {
      sdkVersion = versionRange;
    }

    log.info(`📦 Installing Claude Code CLI from @anthropic-ai/claude-agent-sdk@${sdkVersion}...`);

    // Create temp directory
    const tempDir = await mkdtemp(join(tmpdir(), "claude-cli-"));
    const tarballPath = join(tempDir, "package.tgz");

    try {
      // Download tarball from npm
      const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmjs.org";
      const tarballUrl = `${npmRegistry}/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-${sdkVersion}.tgz`;

      log.info(`Downloading from ${tarballUrl}...`);
      const response = await fetch(tarballUrl);
      if (!response.ok) {
        throw new Error(`Failed to download tarball: ${response.status} ${response.statusText}`);
      }

      // Write tarball to file
      if (!response.body) throw new Error("Response body is null");
      const fileStream = createWriteStream(tarballPath);
      await pipeline(response.body, fileStream);
      log.info(`Downloaded tarball to ${tarballPath}`);

      // Extract tarball
      log.info(`Extracting tarball...`);
      execSync(`tar -xzf "${tarballPath}" -C "${tempDir}"`, { stdio: "pipe" });

      // Find cli.js in the extracted package
      const extractedDir = join(tempDir, "package");
      const cliPath = join(extractedDir, "cli.js");

      if (!existsSync(cliPath)) {
        throw new Error(`cli.js not found in extracted package at ${cliPath}`);
      }
      log.info(`✓ Claude Code CLI installed at ${cliPath}`);
      return cliPath;
    } catch (error) {
      // Cleanup on error
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  },
  run: async ({ prompt, mcpServers, apiKey, cliPath }) => {
    process.env.ANTHROPIC_API_KEY = apiKey;

    const queryInstance = query({
      prompt: `${instructions}\n\n****** USER PROMPT ******\n${prompt}`,
      options: {
        permissionMode: "bypassPermissions",
        mcpServers,
        pathToClaudeCodeExecutable: cliPath,
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
});

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
