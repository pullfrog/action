import { type } from "arktype";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const GetIssueEvents = type({
  issue_number: type.number.describe("The issue number to get events for"),
});

export function GetIssueEventsTool(ctx: ToolContext) {
  return tool({
    name: "get_issue_events",
    description:
      "Get timeline events for a GitHub issue that aren't reflected in the current state. Returns cross-references to other issues/PRs and commit references. Note: current labels, assignees, state, and milestone are already available via get_issue.",
    parameters: GetIssueEvents,
    execute: execute(async ({ issue_number }) => {
      // set issue context
      ctx.toolState.issueNumber = issue_number;

      const events = await ctx.octokit.paginate(ctx.octokit.rest.issues.listEventsForTimeline, {
        owner: ctx.owner,
        repo: ctx.name,
        issue_number,
      });

      // Only include events not reflected in current issue state (get_issue already has labels, assignees, state, etc.)
      // Keep only relationship/reference events that show connections to other issues/PRs/commits
      const relevantEventTypes = new Set(["cross_referenced", "referenced"]);

      const parsedEvents = events.flatMap((event) => {
        // Filter to only events with an 'event' property and relevant types
        if (!("event" in event) || !relevantEventTypes.has(event.event)) {
          return [];
        }

        const baseEvent: Record<string, any> = {
          event: event.event,
        };

        // Common fields
        if ("id" in event) {
          baseEvent.id = event.id;
        }
        if ("actor" in event && event.actor) {
          baseEvent.actor = event.actor.login;
        } else if ("user" in event && event.user) {
          baseEvent.actor = event.user.login;
        }
        if ("created_at" in event) {
          baseEvent.created_at = event.created_at;
        }

        // Event-specific data
        if (event.event === "cross_referenced") {
          if ("source" in event && event.source) {
            const source = event.source as {
              type?: string;
              issue?: { number: number; title: string; html_url: string };
              pull_request?: { number: number; title: string; html_url: string };
            };
            baseEvent.source = {
              type: source.type,
              issue: source.issue
                ? {
                    number: source.issue.number,
                    title: source.issue.title,
                    html_url: source.issue.html_url,
                  }
                : null,
              pull_request: source.pull_request
                ? {
                    number: source.pull_request.number,
                    title: source.pull_request.title,
                    html_url: source.pull_request.html_url,
                  }
                : null,
            };
          }
        }

        if (event.event === "referenced") {
          if ("commit_id" in event) {
            baseEvent.commit_id = event.commit_id;
          }
          if ("commit_url" in event) {
            baseEvent.commit_url = event.commit_url;
          }
        }

        return [baseEvent];
      });

      return {
        issue_number,
        events: parsedEvents,
        count: parsedEvents.length,
      };
    }),
  });
}
