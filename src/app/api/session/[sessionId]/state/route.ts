import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { getSession, publicSessionState } from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });

// Exposes only public session state and omits promises, sets, and raw logs.
export async function GET(
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
    return NextResponse.json(publicSessionState(session));
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.state", error)
      : logServerError("api.session.state", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError ? "Invalid session id" : "State failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
