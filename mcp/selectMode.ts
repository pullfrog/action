import { type } from "arktype";
import { contextualize, tool } from "./shared.ts";

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
  execute: contextualize(async ({ modeName }, ctx) => {
    const selectedMode = ctx.modes.find((m) => m.name.toLowerCase() === modeName.toLowerCase());

    if (!selectedMode) {
      const availableModes = ctx.modes.map((m) => m.name).join(", ");
      return {
        error: `Mode "${modeName}" not found. Available modes: ${availableModes}`,
        availableModes: ctx.modes.map((m) => ({ name: m.name, description: m.description })),
      };
    }

    return {
      modeName: selectedMode.name,
      description: selectedMode.description,
      prompt: selectedMode.prompt,
    };
  }),
});
