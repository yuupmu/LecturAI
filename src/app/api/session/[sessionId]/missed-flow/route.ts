import { NextResponse } from "next/server";
import { z } from "zod";
import { createMissedFlowRequest } from "@/backend/lecture/missed-flow/missed-flow-pipeline";
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
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const result = createMissedFlowRequest(session);
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    const ending = error instanceof Error &&
      error.message === "SESSION_NOT_ACCEPTING_MISSED_FLOW";
    return NextResponse.json({
      error: ending
        ? "수업을 마무리하고 있어 새 복구 요청을 받을 수 없습니다."
        : "놓친 흐름 복구를 시작하지 못했습니다.",
    }, { status: ending ? 409 : 500 });
  }
}
