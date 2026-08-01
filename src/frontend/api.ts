import { z } from "zod";
import {
  CreateSessionResponseSchema,
  RawLogsResponseDtoSchema,
  RealtimeTokenDtoSchema,
  SessionStateDtoSchema,
  TranscriptResponseDtoSchema,
  type CreateSessionResponse,
  type RawLogsResponseDto,
  type RealtimeTokenDto,
  type SessionStateDto,
  type TranscriptInputDto,
  type TranscriptResponseDto,
} from "./types";

// ApiError retains status and the unmodified error payload for inline messages.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;
  const rawBody = await response.text();
  try {
    payload = rawBody ? JSON.parse(rawBody) as unknown : null;
  } catch {
    payload = { unparseableBody: rawBody.slice(0, 4_000) };
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `요청에 실패했습니다. (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      "서버 응답 형식을 확인할 수 없습니다.",
      response.status,
      { response: payload, validation: z.treeifyError(parsed.error) },
    );
  }
  return parsed.data;
}

export async function createSession(input: {
  material: File | null;
  instruction: string;
  language: string;
}): Promise<CreateSessionResponse> {
  const form = new FormData();
  if (input.material) form.set("material", input.material);
  form.set("instruction", input.instruction);
  form.set("language", input.language);
  return parseResponse(
    await fetch("/api/session", { method: "POST", body: form }),
    CreateSessionResponseSchema,
  );
}

export async function createRealtimeToken(
  sessionId: string,
): Promise<RealtimeTokenDto> {
  return parseResponse(
    await fetch("/api/realtime/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }),
    RealtimeTokenDtoSchema,
  );
}

export async function postTranscript(
  sessionId: string,
  transcript: TranscriptInputDto,
): Promise<TranscriptResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transcript),
    }),
    TranscriptResponseDtoSchema,
  );
}

export async function getSessionState(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionStateDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/state`, {
      cache: "no-store",
      signal,
    }),
    SessionStateDtoSchema,
  );
}

export async function getRawLogs(
  sessionId: string,
  after: number,
  signal?: AbortSignal,
): Promise<RawLogsResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/raw?after=${after}`,
      { cache: "no-store", signal },
    ),
    RawLogsResponseDtoSchema,
  );
}

export async function resetSession(
  sessionId: string,
): Promise<SessionStateDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/reset`, {
      method: "POST",
    }),
    SessionStateDtoSchema,
  );
}
