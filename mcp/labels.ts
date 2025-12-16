import { type } from "arktype";
import type { Context } from "../main.ts";
import { execute, tool } from "./shared.ts";

export const AddLabelsParams = type({
  issue_number: type.number.describe("the issue or PR number to add labels to"),
  labels: type.string.array().atLeastLength(1).describe("array of label names to add"),
});

export function AddLabelsTool(ctx: Context) {
  return tool({
    name: "add_labels",
    description:
      "Add labels to a GitHub issue or pull request. Only use labels that already exist in the repository.",
    parameters: AddLabelsParams,
    execute: execute(ctx, async ({ issue_number, labels }) => {
      const result = await ctx.octokit.rest.issues.addLabels({
        owner: ctx.owner,
        repo: ctx.name,
        issue_number,
        labels,
      });

      return {
        success: true,
        labels: result.data.map((label) => label.name),
      };
    }),
  });
}
