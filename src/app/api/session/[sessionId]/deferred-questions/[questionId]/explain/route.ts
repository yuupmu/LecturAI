import { NextResponse } from "next/server";
import { z } from "zod";
import { startUnderstandingBranchFromDeferred } from "@/backend/lecture/understanding/branch-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string; questionId: string }> },
) {
  try {
    const { sessionId, questionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const question = session.deferredQuestions.find((candidate) => candidate.id === questionId);
    if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404 });
    const result = startUnderstandingBranchFromDeferred(
      session,
      `${question.focusText}\n\n학생이 맡겨둔 질문: ${question.question}`,
    );
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: "AI 보충 설명을 열지 못했습니다." }, {
      status: error instanceof z.ZodError ? 400 : 409,
    });
  }
}
