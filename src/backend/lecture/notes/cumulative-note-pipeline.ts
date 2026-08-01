import { randomUUID } from "node:crypto";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  NoteCompositionSchema,
  NoteReviewSchema,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type NoteGenerationTrigger,
  type NoteReview,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  buildNoteGenerationContext,
  hasUnprocessedTranscript,
  latestTranscriptSequence,
  type NoteGenerationContext,
} from "./build-note-generation-context";
import { generateCumulativeNote } from "./generate-cumulative-note";
import { mergeCumulativeNote } from "./merge-cumulative-note";
import { reviewCumulativeNote } from "./review-cumulative-note";
import { reviseCumulativeNote } from "./revise-cumulative-note";
import {
  applyNoteReviewCorrections,
  sanitizeCumulativeComposition,
  validateCumulativeNote,
} from "./validate-cumulative-note";

export interface NoteGenerationDependencies {
  compose: (
    session: LectureSession,
    context: NoteGenerationContext,
    baseRevision: number,
  ) => Promise<NoteComposition>;
  review: (
    session: LectureSession,
    context: NoteGenerationContext,
    note: LectureNote,
    baseRevision: number,
  ) => Promise<NoteReview>;
  revise: (
    session: LectureSession,
    context: NoteGenerationContext,
    note: LectureNote,
    review: NoteReview,
    baseRevision: number,
  ) => Promise<NoteComposition>;
}

export interface NoteGenerationRequestResult {
  accepted: boolean;
  queued: boolean;
  message: string;
}

interface NoteGenerationJob {
  id: string;
  trigger: NoteGenerationTrigger;
  snapshotSequence: number;
  snapshotItemIds: string[];
  epoch: number;
}

const defaultDependencies: NoteGenerationDependencies = {
  compose: generateCumulativeNote,
  review: reviewCumulativeNote,
  revise: reviseCumulativeNote,
};

class StaleNoteGenerationError extends Error {
  constructor() {
    super("NOTE_GENERATION_STALE");
    this.name = "StaleNoteGenerationError";
  }
}

function noteLogPayload(
  session: LectureSession,
  context: NoteGenerationContext,
  job: NoteGenerationJob,
  startedAt: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    jobId: job.id,
    trigger: job.trigger,
    fromSequence: context.lastProcessedSequence + 1,
    throughSequence: context.snapshotSequence,
    existingNoteRevision: context.existingNote?.revision ?? null,
    resultNoteRevision: session.noteGeneration.revision || null,
    newTurnCount: context.newTurnsToProcess.length,
    durationMs: Date.now() - startedAt,
    reason,
  };
}

function isGenerationActive(session: LectureSession): boolean {
  return session.noteGeneration.activeJobId !== null ||
    session.noteGeneration.status === "queued" ||
    session.noteGeneration.status === "generating" ||
    session.noteGeneration.status === "reviewing";
}

function assertCurrentJob(session: LectureSession, job: NoteGenerationJob): void {
  if (
    session.noteGenerationEpoch !== job.epoch ||
    session.noteGeneration.activeJobId !== job.id
  ) {
    throw new StaleNoteGenerationError();
  }
  if (
    job.trigger !== "final" &&
    (session.status === "finalizing" || session.status === "ended")
  ) {
    throw new StaleNoteGenerationError();
  }
}

function makeJob(
  session: LectureSession,
  trigger: NoteGenerationTrigger,
): NoteGenerationJob {
  return {
    id: randomUUID(),
    trigger,
    snapshotSequence: latestTranscriptSequence(session),
    snapshotItemIds: session.transcripts.map((turn) => turn.itemId),
    epoch: session.noteGenerationEpoch,
  };
}

function queueState(session: LectureSession, job: NoteGenerationJob): void {
  session.noteGeneration.status = "queued";
  session.noteGeneration.activeJobId = job.id;
  session.noteGeneration.activeTrigger = job.trigger;
  session.noteGeneration.lastError = null;
  touchSession(session);
  const context = buildNoteGenerationContext(
    session,
    job.trigger,
    job.snapshotSequence,
    job.snapshotItemIds,
  );
  appendRawLog(
    session,
    "system",
    job.trigger === "manual" ? "note_manual_requested" : "note_job_queued",
    noteLogPayload(session, context, job, Date.now(), "queued"),
  );
}

function fallbackFinalNote(
  session: LectureSession,
  context: NoteGenerationContext,
  baseRevision: number,
): LectureNote | null {
  if (!context.existingNote && context.newTurnsToProcess.length === 0) return null;
  const existingSections = context.existingNote?.sections.map((section) => ({
    heading: section.heading,
    layout: section.layout,
    items: section.items.map((item) => ({
      text: item.text,
      importance: item.importance,
      sourceItemIds: item.sourceItemIds,
      sourcePages: item.sourcePages,
    })),
  })) ?? [];
  const existingSources = new Set(context.existingNote?.sourceItemIds ?? []);
  const fallbackTurns = context.newTurnsToProcess.filter(
    (turn) => !existingSources.has(turn.itemId),
  );
  const sections = [...existingSections];
  if (fallbackTurns.length > 0) {
    sections.push({
      heading: "마지막 수업 내용",
      layout: "bullets" as const,
      items: fallbackTurns.map((turn) => ({
        text: turn.text.trim(),
        importance: "normal" as const,
        sourceItemIds: [turn.itemId],
        sourcePages: [],
      })),
    });
  }
  const composition = NoteCompositionSchema.parse({
    baseRevision,
    title: context.existingNote?.title || session.materialKnowledge.title || "강의 필기",
    sections,
  });
  return mergeCumulativeNote(
    composition,
    context.existingNote,
    "final",
    context.snapshotSequence,
  );
}

async function runNoteGenerationJob(
  session: LectureSession,
  job: NoteGenerationJob,
  dependencies: NoteGenerationDependencies,
): Promise<void> {
  const startedAt = Date.now();
  const state = session.noteGeneration;
  const baseRevision = state.revision;
  const context = buildNoteGenerationContext(
    session,
    job.trigger,
    job.snapshotSequence,
    job.snapshotItemIds,
  );
  const finishWithoutModel = () => {
    if (state.activeJobId === job.id) {
      state.activeJobId = null;
      state.activeTrigger = null;
    }
    touchSession(session);
  };
  if (
    job.trigger !== "final" &&
    context.newTurnsToProcess.length === 0
  ) {
    state.status = "completed";
    state.lastError = null;
    appendRawLog(
      session,
      "system",
      "note_schedule_skipped",
      noteLogPayload(session, context, job, startedAt, "no_new_transcript"),
    );
    finishWithoutModel();
    return;
  }
  if (
    job.trigger === "final" &&
    !context.existingNote &&
    context.newTurnsToProcess.length === 0
  ) {
    state.status = "completed";
    state.lastError = null;
    appendRawLog(
      session,
      "system",
      "final_note_completed",
      noteLogPayload(session, context, job, startedAt, "no_meaningful_content"),
    );
    finishWithoutModel();
    return;
  }

  state.status = "generating";
  touchSession(session);
  appendRawLog(
    session,
    "system",
    job.trigger === "final" ? "final_note_started" : "note_generation_started",
    noteLogPayload(session, context, job, startedAt, "composer_started"),
  );
  appendRawLog(
    session,
    "system",
    "note_generation_context_built",
    {
      ...noteLogPayload(session, context, job, startedAt, "snapshot_context"),
      contextOnlyTurnCount: context.contextOnlyTurns.length,
      oversizedExistingNote:
        JSON.stringify(context.existingNote).length > 120_000,
      oversizedMaterialKnowledge:
        JSON.stringify(context.materialKnowledge).length > 120_000,
      approximateInputCharacters:
        JSON.stringify(context.existingNote).length +
        JSON.stringify(context.materialKnowledge).length +
        context.contextOnlyTurns.reduce((sum, turn) => sum + turn.text.length, 0) +
        context.newTurnsToProcess.reduce((sum, turn) => sum + turn.text.length, 0),
    },
  );

  try {
    const composition = sanitizeCumulativeComposition(
      session,
      context,
      await dependencies.compose(session, context, baseRevision),
      baseRevision,
    );
    if (!composition) throw new Error("NOTE_DRAFT_HAS_NO_GROUNDED_ITEMS");
    assertCurrentJob(session, job);
    let draft = mergeCumulativeNote(
      composition,
      context.existingNote,
      job.trigger === "final" ? "final" : "live",
      context.snapshotSequence,
    );

    state.status = "reviewing";
    touchSession(session);
    appendRawLog(
      session,
      "system",
      "note_review_started",
      noteLogPayload(session, context, job, startedAt, "grounding_review"),
    );
    const review = NoteReviewSchema.parse(
      await dependencies.review(session, context, draft, baseRevision),
    );
    assertCurrentJob(session, job);
    if (review.baseRevision !== baseRevision) {
      throw new Error("NOTE_REVIEW_STALE_REVISION");
    }
    appendRawLog(
      session,
      "system",
      "note_review_completed",
      noteLogPayload(
        session,
        context,
        job,
        startedAt,
        review.publishable ? "publishable" : "revision_required",
      ),
    );
    if (review.publishable) {
      draft = applyNoteReviewCorrections(draft, review);
    } else {
      appendRawLog(
        session,
        "system",
        "note_revision_started",
        noteLogPayload(session, context, job, startedAt, "single_revision"),
      );
      const revised = sanitizeCumulativeComposition(
        session,
        context,
        await dependencies.revise(
          session,
          context,
          draft,
          review,
          baseRevision,
        ),
        baseRevision,
      );
      assertCurrentJob(session, job);
      if (!revised) throw new Error("NOTE_REVISION_HAS_NO_GROUNDED_ITEMS");
      draft = mergeCumulativeNote(
        revised,
        context.existingNote,
        job.trigger === "final" ? "final" : "live",
        context.snapshotSequence,
      );
      appendRawLog(
        session,
        "system",
        "note_revision_completed",
        noteLogPayload(session, context, job, startedAt, "single_revision_completed"),
      );
    }

    assertCurrentJob(session, job);
    if (!validateCumulativeNote(session, context, draft)) {
      appendRawLog(
        session,
        "system",
        "note_evidence_rejected",
        noteLogPayload(session, context, job, startedAt, "server_validation_failed"),
      );
      throw new Error("NOTE_FINAL_SERVER_VALIDATION_FAILED");
    }

    if (job.trigger === "final") {
      state.finalNote = draft;
      session.lectureNotes = [draft];
    } else {
      state.currentNote = draft;
      session.lectureNotes = [draft];
    }
    state.lastProcessedSequence = Math.max(
      state.lastProcessedSequence,
      context.snapshotSequence,
    );
    state.processedItemIds = Array.from(new Set([
      ...state.processedItemIds,
      ...context.newTurnsToProcess.map((turn) => turn.itemId),
    ]));
    state.lastGeneratedAt = new Date().toISOString();
    state.revision += 1;
    state.status = "completed";
    state.lastError = null;
    touchSession(session);
    appendRawLog(
      session,
      "system",
      job.trigger === "final" ? "final_note_completed" : "note_generation_completed",
      noteLogPayload(session, context, job, startedAt, "grounded_note_published"),
    );
  } catch (error) {
    if (error instanceof StaleNoteGenerationError) return;
    if (session.noteGenerationEpoch !== job.epoch) return;
    const message = error instanceof Error ? error.message : "unknown_note_error";
    recordSessionError(session, "cumulative_note_generation", error, {
      jobId: job.id,
      trigger: job.trigger,
      snapshotSequence: job.snapshotSequence,
    });
    state.lastError = message;
    if (job.trigger === "final") {
      const fallback = fallbackFinalNote(session, context, baseRevision);
      if (fallback) {
        state.finalNote = fallback;
        state.lastProcessedSequence = Math.max(
          state.lastProcessedSequence,
          context.snapshotSequence,
        );
        state.processedItemIds = Array.from(new Set([
          ...state.processedItemIds,
          ...context.newTurnsToProcess.map((turn) => turn.itemId),
        ]));
        state.lastGeneratedAt = new Date().toISOString();
        state.revision += 1;
        state.status = "completed";
        session.lectureNotes = [fallback];
      } else {
        state.status = "failed";
      }
      appendRawLog(
        session,
        "system",
        "final_note_failed",
        noteLogPayload(
          session,
          context,
          job,
          startedAt,
          fallback ? `fallback_published:${message}` : message,
        ),
      );
    } else {
      state.status = "failed";
      appendRawLog(
        session,
        "system",
        "note_generation_failed",
        noteLogPayload(session, context, job, startedAt, message),
      );
    }
    touchSession(session);
  } finally {
    if (
      session.noteGenerationEpoch === job.epoch &&
      state.activeJobId === job.id
    ) {
      state.activeJobId = null;
      state.activeTrigger = null;
      touchSession(session);
    }
  }
}

function timerCanRun(session: LectureSession): boolean {
  return session.noteGeneration.enabled &&
    session.status === "listening" &&
    session.noteGeneration.activeTrigger !== "final";
}

export function clearAutomaticNoteSchedule(
  session: LectureSession,
  reason: string,
): void {
  if (session.noteGenerationTimer) clearTimeout(session.noteGenerationTimer);
  session.noteGenerationTimer = null;
  session.noteGeneration.nextScheduledAt = null;
  appendRawLog(session, "system", "note_timer_reset", {
    sessionId: session.id,
    jobId: null,
    trigger: null,
    fromSequence: session.noteGeneration.lastProcessedSequence + 1,
    throughSequence: latestTranscriptSequence(session),
    existingNoteRevision: session.noteGeneration.currentNote?.revision ?? null,
    resultNoteRevision: session.noteGeneration.revision || null,
    newTurnCount: 0,
    durationMs: 0,
    reason,
  });
}

export function scheduleNextAutomaticNote(
  session: LectureSession,
  reason: string,
  dependencies: NoteGenerationDependencies = defaultDependencies,
): void {
  if (session.noteGenerationTimer) clearTimeout(session.noteGenerationTimer);
  session.noteGenerationTimer = null;
  if (!timerCanRun(session)) {
    session.noteGeneration.nextScheduledAt = null;
    touchSession(session);
    return;
  }
  const epoch = session.noteGenerationEpoch;
  const delayMs = session.noteGeneration.intervalSeconds * 1_000;
  const nextScheduledAt = new Date(Date.now() + delayMs).toISOString();
  session.noteGeneration.nextScheduledAt = nextScheduledAt;
  const timer = setTimeout(() => {
    if (
      session.noteGenerationEpoch !== epoch ||
      session.noteGeneration.nextScheduledAt !== nextScheduledAt
    ) return;
    session.noteGenerationTimer = null;
    session.noteGeneration.nextScheduledAt = null;
    touchSession(session);
    requestNoteGeneration(session, "scheduled", dependencies);
    if (!session.noteGeneration.nextScheduledAt && timerCanRun(session)) {
      scheduleNextAutomaticNote(session, "scheduled_checkpoint", dependencies);
    }
  }, delayMs);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  session.noteGenerationTimer = timer;
  touchSession(session);
  const processedItemIds = new Set(session.noteGeneration.processedItemIds);
  appendRawLog(session, "system", "note_schedule_started", {
    sessionId: session.id,
    jobId: null,
    trigger: "scheduled",
    fromSequence: session.noteGeneration.lastProcessedSequence + 1,
    throughSequence: latestTranscriptSequence(session),
    existingNoteRevision: session.noteGeneration.currentNote?.revision ?? null,
    resultNoteRevision: session.noteGeneration.revision || null,
    newTurnCount: session.transcripts.filter(
      (turn) => !processedItemIds.has(turn.itemId),
    ).length,
    durationMs: 0,
    reason,
  });
}

export function startAutomaticNoteSchedule(session: LectureSession): void {
  if (!session.noteGeneration.nextScheduledAt && timerCanRun(session)) {
    scheduleNextAutomaticNote(session, "lecture_started");
  }
}

export function setAutomaticNoteGeneration(
  session: LectureSession,
  enabled: boolean,
): NoteGenerationRequestResult {
  if (session.status === "finalizing" || session.status === "ended") {
    return { accepted: false, queued: false, message: "종료된 수업의 설정은 변경할 수 없습니다." };
  }
  session.noteGeneration.enabled = enabled;
  if (enabled) scheduleNextAutomaticNote(session, "automatic_notes_enabled");
  else clearAutomaticNoteSchedule(session, "automatic_notes_disabled");
  touchSession(session);
  const intervalLabel = session.noteGeneration.intervalSeconds === 120
    ? "2분"
    : `${session.noteGeneration.intervalSeconds}초`;
  return {
    accepted: true,
    queued: false,
    message: enabled
      ? `자동 필기를 켰습니다. ${intervalLabel} 뒤 최신 대본을 정리합니다.`
      : "자동 필기를 껐습니다. 대본 저장과 수동 필기는 계속됩니다.",
  };
}

async function drainOnePendingManualRequest(
  session: LectureSession,
  dependencies: NoteGenerationDependencies,
): Promise<void> {
  if (!session.noteGeneration.pendingManualRequest) return;
  session.noteGeneration.pendingManualRequest = false;
  if (
    session.status !== "listening" ||
    !hasUnprocessedTranscript(session)
  ) {
    touchSession(session);
    return;
  }
  const job = makeJob(session, "manual");
  queueState(session, job);
  await runNoteGenerationJob(session, job, dependencies);
}

export function requestNoteGeneration(
  session: LectureSession,
  trigger: Exclude<NoteGenerationTrigger, "final">,
  dependencies: NoteGenerationDependencies = defaultDependencies,
): NoteGenerationRequestResult {
  if (session.status === "finalizing" || session.status === "ended") {
    return { accepted: false, queued: false, message: "수업을 마무리하고 있어 새 필기를 요청할 수 없습니다." };
  }
  if (isGenerationActive(session)) {
    if (trigger === "manual") {
      session.noteGeneration.pendingManualRequest = true;
      touchSession(session);
      appendRawLog(session, "system", "note_manual_requested", {
        sessionId: session.id,
        jobId: session.noteGeneration.activeJobId,
        trigger,
        fromSequence: session.noteGeneration.lastProcessedSequence + 1,
        throughSequence: latestTranscriptSequence(session),
        existingNoteRevision: session.noteGeneration.currentNote?.revision ?? null,
        resultNoteRevision: null,
        newTurnCount: 0,
        durationMs: 0,
        reason: "pending_after_active_job",
      });
      return {
        accepted: true,
        queued: true,
        message: "현재 필기 생성 후 최신 내용으로 다시 정리합니다.",
      };
    }
    return { accepted: false, queued: false, message: "필기를 이미 생성하고 있습니다." };
  }

  const job = makeJob(session, trigger);
  const preview = buildNoteGenerationContext(
    session,
    trigger,
    job.snapshotSequence,
    job.snapshotItemIds,
  );
  if (preview.newTurnsToProcess.length === 0) {
    if (trigger === "scheduled") scheduleNextAutomaticNote(session, "no_new_transcript");
    return { accepted: false, queued: false, message: "새로 정리할 수업 내용이 없습니다." };
  }
  queueState(session, job);
  session.noteGenerationChain = session.noteGenerationChain
    .catch(() => undefined)
    .then(async () => {
      await runNoteGenerationJob(session, job, dependencies);
      await drainOnePendingManualRequest(session, dependencies);
      if (
        session.status === "listening" &&
        !session.noteGeneration.nextScheduledAt
      ) {
        scheduleNextAutomaticNote(
          session,
          `${trigger}_job_finished`,
          dependencies,
        );
      }
    });
  return {
    accepted: true,
    queued: true,
    message: trigger === "manual"
      ? "지금까지의 수업 내용을 정리하기 시작했습니다."
      : "자동 필기를 시작했습니다.",
  };
}

export async function runFinalNoteGeneration(
  session: LectureSession,
  dependencies: NoteGenerationDependencies = defaultDependencies,
): Promise<void> {
  session.noteGeneration.pendingManualRequest = false;
  const job = makeJob(session, "final");
  queueState(session, job);
  await runNoteGenerationJob(session, job, dependencies);
}
