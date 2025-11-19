import { type } from "arktype";
import type { Mode } from "../modes.ts";
import { contextualize, tool } from "./shared.ts";

// Get modes from environment variable (set by createMcpConfigs)
function getModes(): Mode[] {
  const modesJson = process.env.PULLFROG_MODES;
  if (modesJson) {
    try {
      return JSON.parse(modesJson);
    } catch {
      return [];
    }
  }
  return [];
}

export const SelectMode = type({
  modeName: type.string.describe(
    "the name of the mode to select (e.g., 'Plan', 'Build', 'Review', 'Prompt')"
  ),
});

export const SelectModeTool = tool({
  name: "select_mode",
  description:
    "Select a mode and get its detailed prompt instructions. Call this first to determine which mode to use based on the request.",
  parameters: SelectMode,
  execute: contextualize(async ({ modeName }) => {
    const allModes = getModes();

    if (allModes.length === 0) {
      return {
        error:
          "No modes available. Modes must be provided via PULLFROG_MODES environment variable.",
      };
    }

    const selectedMode = allModes.find((m) => m.name.toLowerCase() === modeName.toLowerCase());

    if (!selectedMode) {
      const availableModes = allModes.map((m) => m.name).join(", ");
      return {
        error: `Mode "${modeName}" not found. Available modes: ${availableModes}`,
        availableModes: allModes.map((m) => ({ name: m.name, description: m.description })),
      };
    }

    return {
      modeName: selectedMode.name,
      description: selectedMode.description,
      prompt: selectedMode.prompt,
    };
  }),
});
