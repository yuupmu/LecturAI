import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enqueueLectureAssistantRequest,
  InvalidTranscriptSelectionError,
} from "@/backend/lecture/assistant/assistant-pipeline";
import { LectureAssistantRequestInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });

// Captures the transcript boundary synchronously, then schedules generation on
// the assistant-only chain so transcript and note endpoints remain unblocked.
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = SessionParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const input = LectureAssistantRequestInputSchema.parse(await request.json());
    const result = enqueueLectureAssistantRequest(session, input);
    return NextResponse.json({
      accepted: result.accepted,
      requestId: result.request.id,
      snapshotSequence: result.request.snapshotSequence,
      status: result.request.status,
    }, { status: 202 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    const invalidSelection = error instanceof InvalidTranscriptSelectionError;
    const ending = error instanceof Error &&
      error.message === "SESSION_NOT_ACCEPTING_ASSISTANT_REQUESTS";
    return NextResponse.json(
      {
        error: badRequest || invalidSelection
          ? "선택한 번역문 또는 원문 범위를 다시 선택해 주세요."
          : ending
            ? "수업을 마무리하고 있어 새 답변을 받을 수 없습니다."
            : "답변 요청을 처리하지 못했습니다.",
      },
      { status: badRequest || invalidSelection ? 400 : ending ? 409 : 500 },
    );
  }
}
