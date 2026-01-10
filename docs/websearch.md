# Web Search Functionality by Agent

This document describes how each supported agent implements web search functionality.

## Summary

| Agent | Tool Name | Search Provider | API/Method |
|-------|-----------|-----------------|------------|
| Claude Code | `WebSearch` | Anthropic internal | Claude Code SDK |
| Gemini CLI | `google_web_search` | Google Search via Gemini API | `generateContent` with `model: 'web-search'` |
| OpenCode | `websearch` | Exa AI | MCP protocol to `https://mcp.exa.ai/mcp` |

All three agents also support a separate **web fetch** tool for directly retrieving and parsing web page content.

---

## Claude Code

### Tools
- `WebSearch` - Search the web for information
- `WebFetch` - Fetch and process web content

### Implementation
Native functionality through `@anthropic-ai/claude-agent-sdk` (closed source). The actual search provider is internal to Anthropic's infrastructure.

### Configuration in Pullfrog

Web search can be disabled via the `disallowedTools` option:

```typescript
// In sandbox mode, web tools are disabled
disallowedTools: ["Bash", "WebSearch", "WebFetch", "Write"]
```

---

## Gemini CLI

### Tools
- `google_web_search` - Perform web searches using Google Search
- `web_fetch` - Fetch and process content from URLs

### Implementation

Source: [`packages/core/src/tools/web-search.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/web-search.ts)

**How it works:**
1. Sends query to Gemini API using `generateContent` with `model: 'web-search'`
2. Google performs the search and returns results with grounding metadata
3. Response includes inline citations, source URLs, and titles

```typescript
const response = await geminiClient.generateContent(
  { model: 'web-search' },
  [{ role: 'user', parts: [{ text: this.params.query }] }],
  signal,
);
```

### Features
- Returns processed summary (not raw search results)
- Inline citations with grounding metadata
- Sources list with titles and URIs
- UTF-8 byte position handling for accurate citation insertion

### Parameters
- `query` (string, required): The search query

### Web Fetch

The `web_fetch` tool processes content from URLs:
- Uses Gemini API's `urlContext` feature
- Fallback to direct HTTP fetch with `html-to-text` conversion
- Supports up to 20 URLs per request
- Converts GitHub blob URLs to raw URLs automatically

---

## OpenCode

### Tools
- `websearch` - Search the web using Exa AI
- `webfetch` - Fetch and read web pages

### Implementation

Source: [`packages/opencode/src/tool/websearch.ts`](https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/websearch.ts)

**How it works:**
1. Calls Exa AI's MCP endpoint at `https://mcp.exa.ai/mcp`
2. Uses JSON-RPC protocol to invoke the `web_search_exa` tool
3. Parses SSE response for search results

```typescript
const searchRequest: McpSearchRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "web_search_exa",
    arguments: {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
  },
}
```

### Features
- Real-time web searches with content scraping
- Configurable result count (default: 8)
- Live crawl modes: `fallback` (backup if cached unavailable) or `preferred` (prioritize live crawling)
- Search types: `auto` (balanced), `fast` (quick results), `deep` (comprehensive)
- Context max characters for LLM optimization

### Parameters
- `query` (string, required): The search query
- `numResults` (number, optional): Number of results to return (default: 8)
- `livecrawl` (enum, optional): `"fallback"` | `"preferred"`
- `type` (enum, optional): `"auto"` | `"fast"` | `"deep"`
- `contextMaxCharacters` (number, optional): Maximum characters for context

### Configuration in Pullfrog

Web tools are configured via the permission config in `opencode.json`:

```typescript
// In sandbox mode
permission: {
  webfetch: "deny",
  // ...
}

// In normal mode
permission: {
  webfetch: "allow",
  // ...
}
```

### Environment Variables
- `OPENCODE_ENABLE_EXA` - Enable Exa web search tools (required for "zen" users)

### Web Fetch

The `webfetch` tool directly fetches URLs:
- Direct HTTP fetch with browser-like User-Agent
- HTML to Markdown conversion using Turndown
- Configurable timeout (max 120 seconds)
- 5MB response size limit

---

## Comparison

| Feature | Claude Code | Gemini CLI | OpenCode |
|---------|-------------|------------|----------|
| Search Provider | Anthropic | Google | Exa AI |
| Result Format | Summary | Summary + Citations | Raw content |
| URL Fetching | Yes (`WebFetch`) | Yes (`web_fetch`) | Yes (`webfetch`) |
| Grounding/Citations | Unknown | Yes | No |
| Configurable Results | No | No | Yes (numResults) |
| Search Depth Options | No | No | Yes (auto/fast/deep) |
| Live Crawling | Unknown | Fallback only | Configurable |

---

## Security Considerations

In Pullfrog's sandbox mode:
- **Claude Code**: `WebSearch` and `WebFetch` are explicitly disabled via `disallowedTools`
- **Gemini CLI**: No explicit disable mechanism in the wrapper (relies on default behavior)
- **OpenCode**: `webfetch` permission set to `"deny"` in sandbox mode

For public repositories, consider the implications of web search/fetch:
- Fetched content could potentially be used to inject prompts
- Search queries might leak information about the codebase context

---

## Proposed Implementation Plan

### Option 1: Use Native Agent Web Search (Current State)

Each agent uses its own built-in web search:
- **Pros**: No additional implementation, leverages each provider's strengths
- **Cons**: Inconsistent behavior across agents, no unified control

**Current gaps:**
- Gemini CLI has no explicit disable mechanism for web search in sandbox mode
- No unified way to configure web search across all agents

### Option 2: Unified MCP Web Search Tool

Add a `web_search` tool to the Pullfrog MCP server (`mcp/`) that all agents can use:

```
mcp/
├── bash.ts
├── webSearch.ts    # New unified web search tool
└── ...
```

**Implementation approach:**

1. **Create `mcp/webSearch.ts`** with a provider-agnostic interface:
   ```typescript
   export const webSearchTool = {
     name: "web_search",
     description: "Search the web for information",
     inputSchema: {
       type: "object",
       properties: {
         query: { type: "string", description: "Search query" },
         numResults: { type: "number", description: "Number of results (default: 5)" },
       },
       required: ["query"],
     },
   };
   ```

2. **Choose a search provider** (options):
   - **Exa AI** - Already used by OpenCode, good LLM-optimized results
   - **Tavily** - Popular for AI agents, provides search + content extraction
   - **SerpAPI** - Google results via API
   - **Brave Search API** - Privacy-focused alternative

3. **Add to MCP server** in `mcp/server.ts`:
   ```typescript
   import { webSearchTool, handleWebSearch } from "./webSearch.ts";
   // Register tool...
   ```

4. **Disable native web search** for each agent:
   - Claude: Add `"WebSearch"` to `disallowedTools`
   - Gemini: Add `"google_web_search"` to `excludeTools` in settings.json
   - OpenCode: Set `websearch: "deny"` in permission config

**Pros:**
- Consistent behavior across all agents
- Centralized control for security/sandbox modes
- Can filter/sanitize results before returning to agent
- Single API key management

**Cons:**
- Additional API costs (search provider)
- Loses provider-specific features (e.g., Gemini's grounding metadata)

### Option 3: Hybrid Approach

Allow native web search for private repos, use MCP tool for public repos:

```typescript
// In agent configuration
const useNativeWebSearch = !repo.isPublic;

// Claude
disallowedTools: repo.isPublic ? ["WebSearch", "WebFetch"] : [];

// Gemini  
excludeTools: repo.isPublic ? ["google_web_search", "web_fetch"] : [];

// OpenCode
permission: {
  websearch: repo.isPublic ? "deny" : "allow",
}
```

Then for public repos, agents would use the MCP `web_search` tool which:
- Filters sensitive queries
- Sanitizes returned content
- Logs all searches for audit

### Recommended Approach

**Short-term**: Implement Option 3 (Hybrid) with these steps:

1. [ ] Add `excludeTools: ["google_web_search"]` for Gemini in public repo mode
2. [ ] Ensure OpenCode `websearch` permission is properly set for sandbox mode
3. [ ] Document the current native web search behavior for each agent

**Medium-term**: Implement Option 2 (Unified MCP) for public repos:

1. [ ] Create `mcp/webSearch.ts` using Exa AI (consistent with OpenCode)
2. [ ] Add `EXA_API_KEY` to secrets handling
3. [ ] Register web search in MCP server
4. [ ] Disable native web search for all agents when MCP tool is available
5. [ ] Add result sanitization to prevent prompt injection

### API Key Requirements

| Provider | Environment Variable | Notes |
|----------|---------------------|-------|
| Exa AI | `EXA_API_KEY` | Already used by OpenCode |
| Tavily | `TAVILY_API_KEY` | Popular alternative |
| Brave | `BRAVE_API_KEY` | Privacy-focused |

For the unified MCP approach, only one search provider API key would be needed.

---

## Proposed Implementation Plan

### Option A: Unified MCP Web Search Tool

Create a custom MCP tool that provides consistent web search across all agents.

**Pros:**
- Consistent behavior and results across agents
- Full control over search provider and rate limiting
- Can implement caching and deduplication
- Single point for security filtering

**Cons:**
- Additional infrastructure (need a search API key)
- Latency from proxying through MCP server

**Implementation:**
1. Add `websearch` tool to `mcp/` directory
2. Integrate with a search provider (options: Exa AI, SerpAPI, Brave Search, Tavily)
3. Configure each agent to use MCP tool instead of native:
   - Claude: Add to `disallowedTools` and provide via MCP
   - Gemini: Use `excludeTools` in settings.json for `google_web_search`
   - OpenCode: Disable native via permission config

```typescript
// mcp/websearch.ts
export const websearchTool = {
  name: "websearch",
  description: "Search the web for current information",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      numResults: { type: "number", description: "Number of results (1-10)" },
    },
    required: ["query"],
  },
  handler: async ({ query, numResults = 5 }) => {
    // Use Exa, Brave, or other search API
    const results = await searchProvider.search(query, numResults);
    return formatResults(results);
  },
};
```

### Option B: Native Tools with Configuration

Keep using each agent's native web search but add consistent configuration.

**Pros:**
- No additional infrastructure
- Agents can use optimized native implementations
- Less latency

**Cons:**
- Inconsistent results across agents
- Different capabilities per agent
- Harder to control/audit searches

**Implementation:**
1. Add `websearch_enabled` option to payload/config
2. Update each agent wrapper:
   - Claude: Toggle `WebSearch` in `disallowedTools`
   - Gemini: Add `google_web_search` to `excludeTools` in settings.json
   - OpenCode: Set `websearch` permission in config

```typescript
// agents/claude.ts
const disallowedTools = payload.websearchEnabled 
  ? ["Bash"] 
  : ["Bash", "WebSearch", "WebFetch"];

// agents/gemini.ts  
if (!payload.websearchEnabled) {
  newSettings.excludeTools = [...(newSettings.excludeTools || []), "google_web_search"];
}

// agents/opencode.ts
permission: {
  websearch: payload.websearchEnabled ? "allow" : "deny",
  // ...
}
```

### Option C: Hybrid Approach (Recommended)

Use native tools when available, with MCP fallback for consistency.

**Implementation:**
1. Define a `websearch` MCP tool as fallback
2. For agents with good native search (Claude, Gemini): use native
3. For agents without (or with unreliable) search: use MCP tool
4. Add configuration to force MCP-only mode if needed

```typescript
// Per-agent configuration
const agentWebSearchConfig = {
  claude: { useNative: true, mcpFallback: false },
  gemini: { useNative: true, mcpFallback: false },
  opencode: { useNative: false, mcpFallback: true }, // Exa requires API key
};
```

### Required Changes by Option

| Change | Option A | Option B | Option C |
|--------|----------|----------|----------|
| New MCP tool | Yes | No | Yes |
| Search API key | Yes | No | Optional |
| Agent wrapper changes | Yes | Yes | Yes |
| Action input changes | No | Yes | Yes |
| External dependencies | Yes | No | Optional |

### Recommended Next Steps

1. **Decide on search provider** - If going with MCP approach:
   - Exa AI: Already used by OpenCode, good for code-related searches
   - Brave Search: Privacy-focused, good general search
   - Tavily: Designed for AI agents, includes content extraction

2. **Add configuration** - New action inputs:
   ```yaml
   websearch:
     description: 'Enable web search functionality'
     required: false
     default: 'false'
   ```

3. **Implement per-agent** - Start with Option B (simplest), upgrade to C if needed

4. **Add security controls** - Query filtering, domain allowlists, rate limiting
