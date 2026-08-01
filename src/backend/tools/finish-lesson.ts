import { tool } from "@openai/agents";
import { appendRawLog } from "../logs/raw-log";
import { createExplicitEndingCandidate } from "../lecture/activity/lecture-activity-controller";
import {
  FinishLessonArgsSchema,
  type ActionControl,
  type LectureSession,
} from "../schemas";

// Ends a lesson once and atomically exposes a three-question review.
export function createFinishLessonTool(
  session: LectureSession,
  control: ActionControl,
) {
  return tool({
    name: "finish_lesson",
    description:
      "Finish only when NEW_TRANSCRIPT contains an explicit end-of-class statement.",
    parameters: FinishLessonArgsSchema,
    execute: async (input) => {
      const args = FinishLessonArgsSchema.parse(input);
      appendRawLog(session, "tool_call", "finish_lesson", args);

      if (control.actionTaken) {
        const result = { status: "action_limit_ignored" as const };
        appendRawLog(session, "tool_result", "finish_lesson", result);
        return result;
      }
      control.actionTaken = true;
      control.action = "finish_lesson";

      if (session.status === "ended" || session.status === "finalizing") {
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(session, "tool_result", "finish_lesson", result);
        return result;
      }

      createExplicitEndingCandidate(
        session,
        session.transcripts.slice(-6).map((turn) => turn.itemId),
        "finish_lesson_tool_explicit_context",
      );

      const result = {
        status: "ending_candidate" as const,
        closingQuote: args.closingQuote,
        expiresAt: session.activityState.endingCandidate?.expiresAt ?? null,
      };
      appendRawLog(session, "tool_result", "finish_lesson", result);
      return result;
    },
  });
}
