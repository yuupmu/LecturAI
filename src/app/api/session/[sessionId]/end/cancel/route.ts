import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelEndingCandidate } from "@/backend/lecture/activity/lecture-activity-controller";
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
    return NextResponse.json(cancelEndingCandidate(session));
  } catch (error) {
    const conflict = error instanceof Error && error.message === "SESSION_ENDING_NOT_CANCELLABLE";
    return NextResponse.json({
      error: conflict ? "이미 최종 정리를 시작해 자동 종료를 취소할 수 없습니다." : "자동 종료 취소에 실패했습니다.",
    }, { status: conflict ? 409 : 500 });
  }
}
