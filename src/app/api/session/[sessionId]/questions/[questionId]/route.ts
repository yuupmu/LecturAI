import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string; questionId: string }> },
) {
  const { sessionId, questionId } = ParamsSchema.parse(await context.params);
  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  return NextResponse.json({ question });
}
