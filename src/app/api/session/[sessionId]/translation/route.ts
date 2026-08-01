import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import { getSession } from "@/backend/session-store";
import {
  TranslationSettingsInputSchema,
  updateTranslationSettings,
} from "@/backend/translation/translation-settings";

export const runtime = "nodejs";

const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function PATCH(
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
    const input = TranslationSettingsInputSchema.parse(await request.json());
    const translationSettings = updateTranslationSettings(session, input);
    return NextResponse.json({
      ok: true,
      translationSettings,
      version: session.version,
    });
  } catch (error) {
    const log = session
      ? recordSessionError(session, "api.session.translation", error)
      : logServerError("api.session.translation", error);
    return NextResponse.json(
      {
        error: error instanceof z.ZodError
          ? "Invalid translation settings"
          : "Translation settings failed",
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
