import { z } from "zod";
import {
  AssistantRequestResponseDtoSchema,
  AbsenceRequestResponseDtoSchema,
  MissedFlowRequestResponseDtoSchema,
  UnderstandingBranchResponseDtoSchema,
  DeferredQuestionResponseDtoSchema,
  CreateSessionResponseSchema,
  RawLogsResponseDtoSchema,
  NoteRequestResponseDtoSchema,
  NoteSettingsResponseDtoSchema,
  QuestionRequestResponseDtoSchema,
  EndCancelResponseDtoSchema,
  RealtimeTokenDtoSchema,
  SessionStateDtoSchema,
  TranscriptResponseDtoSchema,
  TranslationSettingsResponseDtoSchema,
  type CreateSessionResponse,
  type AssistantRequestResponseDto,
  type AbsenceRequestResponseDto,
  type MissedFlowRequestResponseDto,
  type UnderstandingBranchResponseDto,
  type DeferredQuestionResponseDto,
  type RawLogsResponseDto,
  type NoteRequestResponseDto,
  type NoteSettingsResponseDto,
  type QuestionRequestResponseDto,
  type EndCancelResponseDto,
  type RealtimeTokenDto,
  type SessionStateDto,
  type TranscriptInputDto,
  type TranscriptResponseDto,
  type TranslationSettingsResponseDto,
  type TranslationTargetLanguageDto,
} from "./types";
import type { TranscriptSelectionDto } from "./types";

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

export async function setTranslationSettings(
  sessionId: string,
  input: {
    enabled: boolean;
    targetLanguage: TranslationTargetLanguageDto | null;
  },
): Promise<TranslationSettingsResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/translation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    TranslationSettingsResponseDtoSchema,
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

export async function generateLectureNote(
  sessionId: string,
): Promise<NoteRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/notes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    }),
    NoteRequestResponseDtoSchema,
  );
}

export async function setAutomaticLectureNotes(
  sessionId: string,
  enabled: boolean,
): Promise<NoteSettingsResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/notes/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
    NoteSettingsResponseDtoSchema,
  );
}

export async function askLectureAssistant(
  sessionId: string,
  question: string,
): Promise<AssistantRequestResponseDto> {
  return postLectureAssistant(sessionId, {
    mode: "question",
    question,
  });
}

export async function askLectureQuestion(
  sessionId: string,
  question: string,
): Promise<QuestionRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
    QuestionRequestResponseDtoSchema,
  );
}

export async function askTranscriptSelection(
  sessionId: string,
  selection: TranscriptSelectionDto,
): Promise<QuestionRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection }),
    }),
    QuestionRequestResponseDtoSchema,
  );
}

export async function startLectureAbsence(
  sessionId: string,
): Promise<AbsenceRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/absence/start`, {
      method: "POST",
    }),
    AbsenceRequestResponseDtoSchema,
  );
}

export async function endLectureAbsence(
  sessionId: string,
): Promise<AbsenceRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/absence/end`, {
      method: "POST",
    }),
    AbsenceRequestResponseDtoSchema,
  );
}

export async function requestMissedFlowRecovery(
  sessionId: string,
): Promise<MissedFlowRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/missed-flow`, {
      method: "POST",
    }),
    MissedFlowRequestResponseDtoSchema,
  );
}

export async function startUnderstandingBranch(
  sessionId: string,
  selection?: TranscriptSelectionDto,
): Promise<UnderstandingBranchResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/understanding/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection ? { selection } : {}),
    }),
    UnderstandingBranchResponseDtoSchema,
  );
}

export async function sendUnderstandingBranchMessage(
  sessionId: string,
  branchId: string,
  message: string,
): Promise<UnderstandingBranchResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/understanding/branches/${encodeURIComponent(branchId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      },
    ),
    UnderstandingBranchResponseDtoSchema,
  );
}

export async function rejoinUnderstandingBranch(
  sessionId: string,
  branchId: string,
): Promise<UnderstandingBranchResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/understanding/branches/${encodeURIComponent(branchId)}/rejoin`,
      { method: "POST" },
    ),
    UnderstandingBranchResponseDtoSchema,
  );
}

export async function createDeferredQuestion(
  sessionId: string,
  input: { selection?: TranscriptSelectionDto; question?: string },
): Promise<DeferredQuestionResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/deferred-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    DeferredQuestionResponseDtoSchema,
  );
}

export async function checkDeferredQuestion(
  sessionId: string,
  questionId: string,
): Promise<DeferredQuestionResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/deferred-questions/${encodeURIComponent(questionId)}/check`,
      { method: "POST" },
    ),
    DeferredQuestionResponseDtoSchema,
  );
}

export async function updateDeferredQuestion(
  sessionId: string,
  questionId: string,
  action: "resolve" | "keep_waiting" | "still_confused",
): Promise<DeferredQuestionResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/deferred-questions/${encodeURIComponent(questionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    ),
    DeferredQuestionResponseDtoSchema,
  );
}

export async function explainDeferredQuestion(
  sessionId: string,
  questionId: string,
): Promise<UnderstandingBranchResponseDto> {
  return parseResponse(
    await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/deferred-questions/${encodeURIComponent(questionId)}/explain`,
      { method: "POST" },
    ),
    UnderstandingBranchResponseDtoSchema,
  );
}

export async function cancelAutomaticEnding(
  sessionId: string,
): Promise<EndCancelResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/end/cancel`, {
      method: "POST",
    }),
    EndCancelResponseDtoSchema,
  );
}

export async function explainTranscriptSelection(
  sessionId: string,
  selection: TranscriptSelectionDto,
): Promise<AssistantRequestResponseDto> {
  return postLectureAssistant(sessionId, {
    mode: "explain_selection",
    ...selection,
  });
}

async function postLectureAssistant(
  sessionId: string,
  payload:
    | { mode: "question"; question: string }
    | ({ mode: "explain_selection" } & TranscriptSelectionDto),
): Promise<AssistantRequestResponseDto> {
  return parseResponse(
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    AssistantRequestResponseDtoSchema,
  );
}
