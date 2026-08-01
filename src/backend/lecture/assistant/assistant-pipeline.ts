import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  LectureAssistantQuestionSchema,
  LectureAssistantRequestInputSchema,
  TranscriptSelectionContextSchema,
  type LectureAssistantQuestion,
  type LectureAssistantRequestInput,
  type LectureSession,
  type TranscriptSelectionContext,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  ASSISTANT_INPUT_LIMIT_MESSAGE,
  AssistantInputLimitError,
  generateLectureAssistantAnswer,
  type LectureAssistantGenerator,
} from "./answer-lecture-question";
import { buildFullLectureContext } from "./build-full-lecture-context";
import type { FullLectureAssistantContext } from "./build-full-lecture-context";
import { validateAssistantAnswer } from "./validate-assistant-answer";
import {
  InvalidQuestionTranscriptSelectionError,
  validateQuestionTranscriptSelection,
} from "../questions/validate-transcript-selection";

export class InvalidTranscriptSelectionError extends Error {
  constructor(message = "선택한 대본 범위를 확인할 수 없습니다.") {
    super(message);
    this.name = "InvalidTranscriptSelectionError";
  }
}

export interface EnqueueAssistantResult {
  accepted: boolean;
  request: LectureAssistantQuestion;
}

export function enqueueLectureAssistantRequest(
  session: LectureSession,
  untrustedInput: z.input<typeof LectureAssistantRequestInputSchema>,
  generator: LectureAssistantGenerator = generateLectureAssistantAnswer,
): EnqueueAssistantResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_ASSISTANT_REQUESTS");
  }
  const input = LectureAssistantRequestInputSchema.parse(untrustedInput);
  const snapshotSequence = session.transcripts.at(-1)?.sequence ?? 0;
  const selection = input.mode === "explain_selection"
    ? validateTranscriptSelection(session, input, snapshotSequence)
    : null;
  const requestKey = buildActiveRequestKey(input, selection);
  const duplicate = session.assistantRequests.find(
    (request) =>
      (request.status === "queued" || request.status === "answering") &&
      buildStoredRequestKey(request) === requestKey,
  );
  if (duplicate) return { accepted: false, request: duplicate };

  const hasActiveRequest = session.assistantRequests.some(
    (request) => request.status === "queued" || request.status === "answering",
  );
  const question = input.mode === "question"
    ? input.question
    : "선택한 수업 내용을 자세히 설명해 주세요.";
  const request = LectureAssistantQuestionSchema.parse({
    id: randomUUID(),
    mode: input.mode,
    question,
    selection,
    snapshotSequence,
    createdAt: new Date().toISOString(),
    status: hasActiveRequest ? "queued" : "answering",
    answer: null,
    errorMessage: null,
  });
  const epoch = session.assistantEpoch;
  const contextSnapshot = buildFullLectureContext(session, {
    mode: request.mode,
    snapshotSequence: request.snapshotSequence,
    question: request.mode === "question" ? request.question : null,
    selection: request.selection,
  });
  session.assistantRequests.push(request);
  touchSession(session);
  appendRawLog(
    session,
    "system",
    input.mode === "question"
      ? "assistant_question_requested"
      : "assistant_selection_requested",
    assistantLogPayload(session, request, 0, "accepted"),
  );
  if (selection) {
    appendRawLog(session, "system", "transcript_selection_created", {
      ...assistantLogPayload(session, request, 0, "assistant_request_submitted"),
      selectedTextLength: selection.selectedText.length,
    });
  }

  const run = async () => {
    await runLectureAssistantRequest(
      session,
      request.id,
      epoch,
      generator,
      contextSnapshot,
    );
  };
  session.assistantChain = session.assistantChain
    .catch(() => undefined)
    .then(run)
    .catch((error) => {
      recordSessionError(session, "assistant_chain", error, {
        requestId: request.id,
      });
    });
  return { accepted: true, request };
}

export async function runLectureAssistantRequest(
  session: LectureSession,
  requestId: string,
  epoch: number,
  generator: LectureAssistantGenerator = generateLectureAssistantAnswer,
  contextSnapshot?: FullLectureAssistantContext,
): Promise<void> {
  if (session.assistantEpoch !== epoch) return;
  const request = session.assistantRequests.find(
    (candidate) => candidate.id === requestId,
  );
  if (!request) return;
  const startedAt = Date.now();
  request.status = "answering";
  request.errorMessage = null;
  touchSession(session);

  try {
    const context = contextSnapshot ?? buildFullLectureContext(session, {
      mode: request.mode,
      snapshotSequence: request.snapshotSequence,
      question: request.mode === "question" ? request.question : null,
      selection: request.selection,
    });
    appendRawLog(session, "system", "assistant_context_built", {
      ...assistantLogPayload(session, request, Date.now() - startedAt, "full_snapshot"),
      transcriptCount: context.fullTranscript.length,
      materialTopicCount: context.materialKnowledge?.outline.length ?? 0,
      hasCurrentNote: context.currentNote !== null,
    });
    appendRawLog(
      session,
      "system",
      "assistant_generation_started",
      assistantLogPayload(session, request, Date.now() - startedAt, "model_call"),
    );

    const modelAnswer = await generator(context);
    if (session.assistantEpoch !== epoch) return;
    const currentRequest = session.assistantRequests.find(
      (candidate) => candidate.id === requestId,
    );
    if (!currentRequest) return;
    currentRequest.answer = validateAssistantAnswer(
      session,
      requestId,
      currentRequest.snapshotSequence,
      modelAnswer,
    );
    currentRequest.status = "answered";
    currentRequest.errorMessage = null;
    touchSession(session);
    appendRawLog(session, "system", "assistant_generation_completed", {
      ...assistantLogPayload(
        session,
        currentRequest,
        Date.now() - startedAt,
        "structured_answer_validated",
      ),
      basis: currentRequest.answer.basis,
    });
    if (currentRequest.selection) {
      appendRawLog(session, "system", "transcript_selection_cleared", {
        ...assistantLogPayload(
          session,
          currentRequest,
          Date.now() - startedAt,
          "selection_request_completed",
        ),
        basis: currentRequest.answer.basis,
      });
    }
  } catch (error) {
    if (session.assistantEpoch !== epoch) return;
    const currentRequest = session.assistantRequests.find(
      (candidate) => candidate.id === requestId,
    );
    if (!currentRequest) return;
    if (error instanceof z.ZodError) {
      appendRawLog(session, "system", "assistant_response_rejected", {
        ...assistantLogPayload(
          session,
          currentRequest,
          Date.now() - startedAt,
          "structured_output_validation_failed",
        ),
        issueCount: error.issues.length,
      });
    }
    currentRequest.status = "failed";
    currentRequest.answer = null;
    currentRequest.errorMessage = error instanceof AssistantInputLimitError
      ? ASSISTANT_INPUT_LIMIT_MESSAGE
      : "답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    touchSession(session);
    appendRawLog(session, "error", "assistant_generation_failed", {
      ...assistantLogPayload(
        session,
        currentRequest,
        Date.now() - startedAt,
        error instanceof Error ? error.message : "unknown_error",
      ),
      inputLimitExceeded: error instanceof AssistantInputLimitError,
    });
    recordSessionError(session, "assistant_generation", error, {
      requestId,
      mode: currentRequest.mode,
      snapshotSequence: currentRequest.snapshotSequence,
    });
  }
}

export function validateTranscriptSelection(
  session: LectureSession,
  untrustedSelection: z.input<typeof TranscriptSelectionContextSchema>,
  snapshotSequence: number,
): TranscriptSelectionContext {
  try {
    return validateQuestionTranscriptSelection(
      session,
      TranscriptSelectionContextSchema.parse(untrustedSelection),
      snapshotSequence,
    );
  } catch (error) {
    if (error instanceof InvalidQuestionTranscriptSelectionError) {
      throw new InvalidTranscriptSelectionError();
    }
    throw error;
  }
}

function normalizeSelectionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function buildActiveRequestKey(
  input: LectureAssistantRequestInput,
  selection: TranscriptSelectionContext | null,
): string {
  return input.mode === "question"
    ? `question:${input.question.trim()}`
    : `selection:${normalizeSelectionText(selection?.selectedText ?? "")}:${
        selection?.sourceItemIds.join(",") ?? ""
      }`;
}

function buildStoredRequestKey(request: LectureAssistantQuestion): string {
  return request.mode === "question"
    ? `question:${request.question.trim()}`
    : `selection:${normalizeSelectionText(request.selection?.selectedText ?? "")}:${
        request.selection?.sourceItemIds.join(",") ?? ""
      }`;
}

function assistantLogPayload(
  session: LectureSession,
  request: LectureAssistantQuestion,
  durationMs: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    requestId: request.id,
    mode: request.mode,
    snapshotSequence: request.snapshotSequence,
    transcriptCount: session.transcripts.filter(
      (transcript) => transcript.sequence <= request.snapshotSequence,
    ).length,
    selectedItemIds: request.selection?.sourceItemIds ?? [],
    basis: request.answer?.basis ?? null,
    durationMs,
    reason,
  };
}
