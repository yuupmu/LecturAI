import { randomUUID } from "node:crypto";
import { tool } from "@openai/agents";
import { appendRawLog } from "../logs/raw-log";
import {
  MarkEmphasisArgsSchema,
  type ActionControl,
  type LectureSession,
} from "../schemas";
import { touchSession } from "../session-store";
import { normalizeText } from "../transcript/normalize-text";

// Stores only explicit emphasis and deduplicates it by concept and page.
export function createMarkEmphasisTool(
  session: LectureSession,
  control: ActionControl,
) {
  return tool({
    name: "mark_emphasis",
    description:
      "Store an explicit exam/importance/must-remember statement from NEW_TRANSCRIPT.",
    parameters: MarkEmphasisArgsSchema,
    execute: async (input) => {
      const args = MarkEmphasisArgsSchema.parse(input);
      appendRawLog(session, "tool_call", "mark_emphasis", args);

      if (control.actionTaken) {
        const result = { status: "action_limit_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }
      control.actionTaken = true;
      control.action = "mark_emphasis";

      const eventKey = `emphasis:${args.slidePage}:${normalizeText(args.concept)}`;
      if (session.eventKeys.has(eventKey)) {
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }

      const event = {
        id: randomUUID(),
        type: "emphasis" as const,
        quote: args.quote,
        concept: args.concept,
        slidePage: args.slidePage,
        createdAt: new Date().toISOString(),
      };
      session.eventKeys.add(eventKey);
      session.events.push(event);
      touchSession(session);

      const result = { status: "stored" as const, event };
      appendRawLog(session, "tool_result", "mark_emphasis", result);
      return result;
    },
  });
}
