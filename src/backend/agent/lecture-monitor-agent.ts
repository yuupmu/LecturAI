import { Agent } from "@openai/agents";
import { getEnv } from "../env";
import type { ActionControl, LectureSession } from "../schemas";
import { createFinishLessonTool } from "../tools/finish-lesson";
import { createMarkEmphasisTool } from "../tools/mark-emphasis";
import { createVerifyClaimTool } from "../tools/verify-claim-with-liner";
import { LECTURE_MONITOR_PROMPT } from "./lecture-monitor-prompt";

// One monitor agent is created per transcript; no handoffs or sub-agents exist.
export function createLectureMonitorAgent(
  session: LectureSession,
  control: ActionControl,
) {
  return new Agent({
    name: "LecturAI Lecture Monitor",
    instructions: LECTURE_MONITOR_PROMPT,
    model: getEnv().OPENAI_SMART_MODEL,
    tools: [
      createMarkEmphasisTool(session, control),
      createVerifyClaimTool(session, control),
      createFinishLessonTool(session, control),
    ],
    modelSettings: { parallelToolCalls: false },
    toolUseBehavior: "stop_on_first_tool",
  });
}
