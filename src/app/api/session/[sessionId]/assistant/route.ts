import { NextResponse } from "next/server";
import { z } from "zod";
import { createLectureQuestion } from "@/backend/lecture/questions/question-pipeline";
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
    if (input.mode !== "question") {
      return NextResponse.json({
        error: "선택 영역 설명은 새 근거 기반 질문창으로 통합 중입니다. 질문창에 선택 내용을 함께 입력해 주세요.",
      }, { status: 410 });
    }
    const result = createLectureQuestion(session, input.question);
    return NextResponse.json({
      accepted: result.accepted,
      requestId: result.question.id,
      snapshotSequence: result.question.askedAtSequence ?? 0,
      status: result.question.status,
    }, { status: 202 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    return NextResponse.json(
      {
        error: badRequest
          ? "질문을 확인해 주세요."
          : "질문 요청을 처리하지 못했습니다.",
      },
      { status: badRequest ? 400 : 500 },
    );
  }
}
