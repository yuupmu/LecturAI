import { NextResponse } from "next/server";
import { z } from "zod";
import { endAbsence } from "@/backend/lecture/absence/absence-pipeline";
import { resumeInactivityMonitor } from "@/backend/lecture/activity/lecture-activity-controller";
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
    const result = endAbsence(session);
    resumeInactivityMonitor(session);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const noActive = error instanceof Error && error.message === "NO_ACTIVE_ABSENCE";
    const ended = error instanceof Error && error.message === "SESSION_ENDED";
    return NextResponse.json({
      error: noActive
        ? "현재 진행 중인 자리 비움 기록이 없습니다."
        : ended
          ? "이미 종료된 수업입니다."
          : "복귀 처리를 시작하지 못했습니다.",
    }, { status: noActive || ended ? 409 : 500 });
  }
}
