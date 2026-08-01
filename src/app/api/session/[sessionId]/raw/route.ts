import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });
const CursorSchema = z.coerce.number().int().nonnegative().default(0);

// Raw logs use a simple monotonically increasing in-memory cursor.
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  let session: ReturnType<typeof getSession> = undefined;
  try {
    const { sessionId } = SessionParamsSchema.parse(await context.params);
    session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const url = new URL(request.url);
    const after = CursorSchema.parse(url.searchParams.get("after") ?? 0);
    const logs = session.rawLogs.filter((log) => log.cursor > after);
    return NextResponse.json({
      logs,
      nextCursor: logs.at(-1)?.cursor ?? after,
    });
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.raw", error)
      : logServerError("api.session.raw", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError ? "Invalid request" : "Raw log failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
