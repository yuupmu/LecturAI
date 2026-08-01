import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeferredQuestion } from "@/backend/lecture/understanding/deferred-question-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const result = createDeferredQuestion(session, await request.json());
    return NextResponse.json(result, { status: result.accepted ? 201 : 200 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    const invalidSelection = error instanceof Error &&
      error.name === "InvalidQuestionTranscriptSelectionError";
    const noTranscript = error instanceof Error && error.message === "DEFERRED_QUESTION_NEEDS_TRANSCRIPT";
    const ending = error instanceof Error && error.message === "SESSION_NOT_ACCEPTING_DEFERRED_QUESTION";
    return NextResponse.json({
      error: badRequest || invalidSelection
        ? "선택한 내용과 질문을 확인해 주세요."
        : noTranscript
          ? "맡길 수 있는 확정 대본이 아직 없습니다."
          : ending
            ? "수업을 마무리하는 동안 새 질문을 맡길 수 없습니다."
            : "질문을 맡기지 못했습니다.",
    }, { status: badRequest || invalidSelection ? 400 : noTranscript || ending ? 409 : 500 });
  }
}
