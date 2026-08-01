import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { setAutomaticNoteGeneration } from "@/backend/lecture/notes/cumulative-note-pipeline";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });
const NoteSettingsSchema = z.object({ enabled: z.boolean() });

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
    const input = NoteSettingsSchema.parse(await request.json());
    const result = setAutomaticNoteGeneration(session, input.enabled);
    return NextResponse.json({ ...result, enabled: session.noteGeneration.enabled });
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.notes.settings", error)
      : logServerError("api.session.notes.settings", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError ? "Invalid note settings" : "Note settings failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
