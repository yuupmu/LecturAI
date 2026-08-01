import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";
const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = ParamsSchema.parse(await context.params);
  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ absenceSpans: session.absenceSpans });
}
