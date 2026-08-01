import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { requestNoteGeneration } from "@/backend/lecture/notes/cumulative-note-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });
const ManualNoteRequestSchema = z.object({
  trigger: z.literal("manual").optional(),
});

export async function POST(
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
    const rawBody = await request.text();
    ManualNoteRequestSchema.parse(rawBody ? JSON.parse(rawBody) : {});
    const result = requestNoteGeneration(session, "manual");
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    const isValidation = error instanceof z.ZodError || error instanceof SyntaxError;
    const log = session
      ? recordSessionError(session, "api.session.notes.generate", error)
      : logServerError("api.session.notes.generate", error);
    return NextResponse.json(
      {
        error: isValidation ? "Invalid note request" : "Note request failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: isValidation ? 400 : 500 },
    );
  }
}
