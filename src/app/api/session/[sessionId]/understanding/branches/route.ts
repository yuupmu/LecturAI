import { NextResponse } from "next/server";
import { z } from "zod";
import { startUnderstandingBranch } from "@/backend/lecture/understanding/branch-pipeline";
import { UnderstandingBranchStartInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = ParamsSchema.parse(await context.params);
    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const input = UnderstandingBranchStartInputSchema.parse(await request.json());
    const result = startUnderstandingBranch(session, input);
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    const badRequest = error instanceof z.ZodError;
    const invalidSelection = error instanceof Error &&
      error.name === "InvalidQuestionTranscriptSelectionError";
    const conflict = error instanceof Error && [
      "SESSION_NOT_ACCEPTING_UNDERSTANDING_BRANCH",
      "UNDERSTANDING_BRANCH_NEEDS_TRANSCRIPT",
    ].includes(error.message);
    return NextResponse.json({
      error: badRequest || invalidSelection
        ? "선택한 대본 범위를 다시 확인해 주세요."
        : error instanceof Error && error.message === "UNDERSTANDING_BRANCH_NEEDS_TRANSCRIPT"
          ? "설명할 확정 대본이 아직 없습니다."
          : conflict
            ? "수업을 마무리하는 동안 새 이해 분기를 시작할 수 없습니다."
            : "이해 분기를 시작하지 못했습니다.",
    }, { status: badRequest || invalidSelection ? 400 : conflict ? 409 : 500 });
  }
}
