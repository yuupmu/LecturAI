import { tool } from "@openai/agents";
import { appendRawLog } from "../logs/raw-log";
import { generateReview } from "../review/generate-review";
import {
  FinishLessonArgsSchema,
  type ActionControl,
  type LectureSession,
} from "../schemas";
import { touchSession } from "../session-store";

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

      if (session.status === "ended") {
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(session, "tool_result", "finish_lesson", result);
        return result;
      }

      const review = await generateReview(session);
      session.review = review;
      session.status = "ended";
      touchSession(session);

      const result = {
        status: "ended" as const,
        closingQuote: args.closingQuote,
        review,
      };
      appendRawLog(session, "tool_result", "finish_lesson", result);
      return result;
    },
  });
}
