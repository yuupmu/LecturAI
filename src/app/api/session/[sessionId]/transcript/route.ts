import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { TranscriptInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";
import { processTranscript } from "@/backend/transcript/process-transcript";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });

// Accepts finalized transcript items and waits for their serialized analysis.
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
    const input = TranscriptInputSchema.parse(await request.json());
    const result = await processTranscript(session, input);
    return NextResponse.json(result);
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.transcript", error)
      : logServerError("api.session.transcript", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError ? "Invalid transcript" : "Transcript failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
