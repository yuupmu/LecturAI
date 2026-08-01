import { NextResponse } from "next/server";
import { z } from "zod";
import { rejoinUnderstandingBranch } from "@/backend/lecture/understanding/branch-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  branchId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string; branchId: string }> },
) {
  try {
    const { sessionId, branchId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const result = rejoinUnderstandingBranch(session, branchId);
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    return NextResponse.json({
      error: badRequest ? "분기 정보를 확인할 수 없습니다." : "현재 수업으로 합류하지 못했습니다.",
    }, { status: badRequest ? 400 : 409 });
  }
}
