import { NextResponse } from "next/server";
import { z } from "zod";
import { updateDeferredQuestion } from "@/backend/lecture/understanding/deferred-question-pipeline";
import { DeferredQuestionUpdateSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string; questionId: string }> },
) {
  try {
    const { sessionId, questionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const { action } = DeferredQuestionUpdateSchema.parse(await request.json());
    return NextResponse.json(updateDeferredQuestion(session, questionId, action));
  } catch (error) {
    return NextResponse.json({ error: "맡겨둔 질문 상태를 바꾸지 못했습니다." }, {
      status: error instanceof z.ZodError ? 400 : 404,
    });
  }
}
