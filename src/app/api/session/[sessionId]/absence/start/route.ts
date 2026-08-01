import { NextResponse } from "next/server";
import { z } from "zod";
import { startAbsence } from "@/backend/lecture/absence/absence-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const result = startAbsence(session);
    return NextResponse.json(result, { status: result.accepted ? 201 : 200 });
  } catch (error) {
    const conflict = error instanceof Error && error.message === "SESSION_NOT_ACCEPTING_ABSENCE";
    return NextResponse.json({
      error: conflict ? "종료 중인 수업에서는 자리 비움을 시작할 수 없습니다." : "자리 비움을 시작하지 못했습니다.",
    }, { status: conflict ? 409 : 500 });
  }
}
