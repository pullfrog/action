# Effort Levels

Pullfrog supports three effort levels that control model selection and reasoning depth:

- **`#mini`** — Fast, minimal reasoning. Best for simple tasks.
- **`#auto`** — Balanced (default). Good for most tasks.
- **`#max`** — Maximum capability. Best for complex tasks requiring deep reasoning.

The effort level can be specified via:
1. Macros in the prompt (`#mini`, `#auto`, `#max`)
2. The `effort` input in `action.yml`
3. The payload's `effort` field

---

## Claude Code

Claude Code uses model selection based on effort level.

| Effort | Model | Description |
|--------|-------|-------------|
| `mini` | `haiku` | Fast, efficient |
| `auto` | `opusplan` | Opus for planning, Sonnet for execution |
| `max` | `opus` | Full Opus |

> **Future direction:** Anthropic's beta `effort` parameter (`low`/`medium`/`high`) could replace model selection, using Opus 4.5 for all tasks with effort controlling token spend. See [Anthropic Effort Docs](https://platform.claude.com/docs/en/build-with-claude/effort).

---

## Codex (OpenAI)

Codex uses both model selection and the `modelReasoningEffort` parameter from `ThreadOptions`.

| Effort | Model | `modelReasoningEffort` | Description |
|--------|-------|------------------------|-------------|
| `mini` | `gpt-5.1-codex-mini` | `"low"` | Smaller model, reduced reasoning |
| `auto` | `gpt-5.1-codex` | default | Standard model, default reasoning |
| `max` | `gpt-5.1-codex-max` | `"high"` | Largest model, maximum reasoning |

Valid values for `modelReasoningEffort`: `"minimal"` | `"low"` | `"medium"` | `"high"`

Reference: [Codex Config Reference](https://developers.openai.com/codex/config-reference/)

---

## Gemini

Gemini uses a combination of model selection and `thinkingLevel` configuration via `settings.json`.

| Effort | Model | `thinkingLevel` | Description |
|--------|-------|-----------------|-------------|
| `mini` | `gemini-2.5-flash` | `LOW` | Fast model, minimal thinking |
| `auto` | `gemini-2.5-flash` | `HIGH` | Fast model, deep thinking |
| `max` | `gemini-2.5-pro` | `HIGH` | Most capable model, deep thinking |

The `thinkingLevel` is configured via:
```json
{
  "modelConfig": {
    "generateContentConfig": {
      "thinkingConfig": {
        "thinkingLevel": "LOW"
      }
    }
  }
}
```

Reference: [Gemini Thinking Docs](https://ai.google.dev/gemini-api/docs/thinking#thinking-levels)

---

## Cursor

Cursor uses model selection via the `--model` CLI flag. Project-level configuration in `.cursor/cli.json` takes precedence if a `model` is specified there.

| Effort | Model | Description |
|--------|-------|-------------|
| `mini` | `auto` (default) | Let Cursor select optimal model |
| `auto` | `auto` (default) | Let Cursor select optimal model |
| `max` | `opus-4.5-thinking` | Claude 4.5 Opus with thinking |

**Note:** If the project has `.cursor/cli.json` with a `model` field, that model is used regardless of effort level.

---

## OpenCode

OpenCode does not currently have affordances for effort-level configuration. The effort parameter is ignored.

| Effort | Behavior |
|--------|----------|
| `mini` | No effect |
| `auto` | No effect |
| `max` | No effect |
