import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeferredQuestionCheck } from "@/backend/lecture/understanding/deferred-question-pipeline";
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
    const result = requestDeferredQuestionCheck(session, questionId);
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: "교수자의 이후 설명을 확인하지 못했습니다." }, {
      status: error instanceof z.ZodError ? 400 : 404,
    });
  }
}
