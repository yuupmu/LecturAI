import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import {
  BackendConfigurationError,
  backendConfigurationErrorMessage,
} from "@/backend/env";
import { createTranscriptionToken } from "@/backend/realtime/create-transcription-token";
import { RealtimeTokenInputSchema } from "@/backend/schemas";
import { getSession } from "@/backend/session-store";

export const runtime = "nodejs";

// Returns the OpenAI ephemeral secret response, never the server API key.
export async function POST(request: Request) {
  let session: ReturnType<typeof getSession> = undefined;
  let requestInputValidated = false;
  try {
    const input = RealtimeTokenInputSchema.parse(await request.json());
    requestInputValidated = true;
    session = getSession(input.sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status === "preparing" || session.status === "error") {
      const log = recordSessionError(
        session,
        "api.realtime.token_not_ready",
        new Error(`Session status is ${session.status}`),
      );
      return NextResponse.json(
        {
          error: "Session is not ready",
          diagnostic: publicErrorDiagnostic(log),
        },
        { status: 409 },
      );
    }
    return NextResponse.json(await createTranscriptionToken(session.slideMap));
  } catch (error) {
    const isRequestValidation =
      !requestInputValidated && error instanceof z.ZodError;
    const isConfiguration = error instanceof BackendConfigurationError;
    const log = session
      ? recordSessionError(session, "api.realtime.token", error)
      : logServerError("api.realtime.token", error);
    return NextResponse.json(
      {
        error: isRequestValidation
          ? "Invalid request"
          : isConfiguration
            ? backendConfigurationErrorMessage(error)
            : "Token creation failed",
        ...(isConfiguration
          ? { code: "SERVER_CONFIGURATION_ERROR" }
          : {}),
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: isRequestValidation ? 400 : isConfiguration ? 503 : 502 },
    );
  }
}
