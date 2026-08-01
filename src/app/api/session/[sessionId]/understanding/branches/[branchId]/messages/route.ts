import { NextResponse } from "next/server";
import { z } from "zod";
import { addUnderstandingBranchMessage } from "@/backend/lecture/understanding/branch-pipeline";
import { UnderstandingBranchMessageInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({
  sessionId: z.string().uuid(),
  branchId: z.string().uuid(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string; branchId: string }> },
) {
  try {
    const { sessionId, branchId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const input = UnderstandingBranchMessageInputSchema.parse(await request.json());
    const result = addUnderstandingBranchMessage(session, branchId, input.message);
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    const conflict = error instanceof Error && error.message === "UNDERSTANDING_BRANCH_NOT_ACTIVE";
    return NextResponse.json({
      error: badRequest
        ? "추가 질문은 1자 이상 4,000자 이하로 입력해 주세요."
        : conflict
          ? "합류를 시작한 분기에는 새 질문을 추가할 수 없습니다."
          : "추가 질문을 보내지 못했습니다.",
    }, { status: badRequest ? 400 : conflict ? 409 : 500 });
  }
}
