import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import {
  getSession,
  publicSessionState,
  resetSession,
} from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });

// Clears volatile lecture progress while retaining the analyzed document.
export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  let session: ReturnType<typeof getSession> = undefined;
  try {
    const { sessionId } = SessionParamsSchema.parse(await context.params);
    session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    await resetSession(session);
    return NextResponse.json(publicSessionState(session));
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.reset", error)
      : logServerError("api.session.reset", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError ? "Invalid session id" : "Reset failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
