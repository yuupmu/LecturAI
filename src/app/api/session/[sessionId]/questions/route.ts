import { NextResponse } from "next/server";
import { z } from "zod";
import { createLectureQuestion } from "@/backend/lecture/questions/question-pipeline";
import {
  InvalidQuestionTranscriptSelectionError,
} from "@/backend/lecture/questions/validate-transcript-selection";
import { LectureQuestionInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = ParamsSchema.parse(await context.params);
  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ questions: session.questions });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const input = LectureQuestionInputSchema.parse(await request.json());
    const result = createLectureQuestion(session, input);
    return NextResponse.json({
      accepted: result.accepted,
      questionId: result.question.id,
      askedAtSequence: result.question.askedAtSequence,
      lectureRevision: result.question.lectureRevision,
      status: result.question.status,
    }, { status: 202 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    const invalidSelection = error instanceof InvalidQuestionTranscriptSelectionError;
    const ending = error instanceof Error && error.message === "SESSION_NOT_ACCEPTING_QUESTIONS";
    return NextResponse.json({
      error: badRequest
        ? "질문은 1자 이상 4,000자 이하로 입력해 주세요."
        : invalidSelection
          ? "선택한 번역문 또는 원문 범위를 다시 선택해 주세요."
        : ending
          ? "수업을 마무리하고 있어 새 질문을 받을 수 없습니다."
          : "질문 요청을 처리하지 못했습니다.",
    }, { status: badRequest || invalidSelection ? 400 : ending ? 409 : 500 });
  }
}
