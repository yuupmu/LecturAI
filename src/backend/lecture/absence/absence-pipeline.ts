import { randomUUID } from "node:crypto";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  AbsenceSpanSchema,
  AbsenceSummaryDraftSchema,
  AbsenceSummaryReviewSchema,
  AbsenceSummarySchema,
  type AbsenceSpan,
  type AbsenceSummary,
  type AbsenceSummaryDraft,
  type LectureSession,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  buildAbsenceContext,
  type AbsenceSummaryContext,
} from "./build-absence-context";
import {
  generateAbsenceSummary,
  type AbsenceSummaryComposer,
} from "./generate-absence-summary";
import {
  reviewAbsenceSummary,
  type AbsenceSummaryReviewer,
} from "./review-absence-summary";

export interface AbsenceDependencies {
  compose: AbsenceSummaryComposer;
  review: AbsenceSummaryReviewer;
}

const defaultDependencies: AbsenceDependencies = {
  compose: generateAbsenceSummary,
  review: reviewAbsenceSummary,
};

export interface AbsenceRequestResult {
  accepted: boolean;
  span: AbsenceSpan;
  message: string;
}

export function startAbsence(session: LectureSession): AbsenceRequestResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_ABSENCE");
  }
  const active = activeAbsence(session);
  if (active) {
    return {
      accepted: false,
      span: active,
      message: "이미 자리 비움 상태입니다. 수업 기록은 계속되고 있습니다.",
    };
  }
  const now = new Date().toISOString();
  const span = AbsenceSpanSchema.parse({
    id: randomUUID(),
    sessionId: session.id,
    status: "active",
    startedAt: now,
    endedAt: null,
    startedAtSequence: session.transcripts.at(-1)?.sequence ?? 0,
    endedAtSequence: null,
    startedAtRevision: session.lectureRevision,
    endedAtRevision: null,
    summary: null,
    errorMessage: null,
  });
  session.absenceSpans.push(span);
  touchSession(session);
  appendRawLog(session, "system", "absence_started", absenceLog(
    session,
    span,
    [],
    0,
    "user_marked_absence",
  ));
  return {
    accepted: true,
    span,
    message: "자리 비움이 시작되었습니다. 녹음·대본·필기는 계속 진행됩니다.",
  };
}

export function endAbsence(
  session: LectureSession,
  dependencies: AbsenceDependencies = defaultDependencies,
): AbsenceRequestResult {
  if (session.status === "ended") throw new Error("SESSION_ENDED");
  const span = activeAbsence(session);
  if (!span) throw new Error("NO_ACTIVE_ABSENCE");
  closeAndQueueAbsence(session, span, dependencies);
  return {
    accepted: true,
    span,
    message: "복귀 구간을 저장했습니다. 놓친 내용을 정리하고 있습니다.",
  };
}

export async function closeActiveAbsenceForFinalization(
  session: LectureSession,
  dependencies: AbsenceDependencies = defaultDependencies,
): Promise<void> {
  const span = activeAbsence(session);
  if (span) closeAndQueueAbsence(session, span, dependencies);
  await session.absenceSummaryChain.catch(() => undefined);
}

function closeAndQueueAbsence(
  session: LectureSession,
  span: AbsenceSpan,
  dependencies: AbsenceDependencies,
): void {
  const now = new Date().toISOString();
  span.status = "summarizing";
  span.endedAt = now;
  span.endedAtSequence = session.transcripts.at(-1)?.sequence ?? span.startedAtSequence;
  span.endedAtRevision = session.lectureRevision;
  span.errorMessage = null;
  const context = buildAbsenceContext(session, span);
  const epoch = session.absenceEpoch;
  touchSession(session);
  appendRawLog(session, "system", "absence_ended", absenceLog(
    session,
    span,
    context.absenceTurns.map((turn) => turn.itemId),
    0,
    "absence_snapshot_closed",
  ));

  session.absenceSummaryChain = session.absenceSummaryChain
    .catch(() => undefined)
    .then(() => runAbsenceSummaryJob(session, span.id, context, epoch, dependencies))
    .catch((error) => {
      recordSessionError(session, "absence_summary_chain", error, {
        absenceSpanId: span.id,
      });
    });
}

async function runAbsenceSummaryJob(
  session: LectureSession,
  spanId: string,
  context: AbsenceSummaryContext,
  epoch: number,
  dependencies: AbsenceDependencies,
): Promise<void> {
  if (session.absenceEpoch !== epoch) return;
  const span = session.absenceSpans.find((candidate) => candidate.id === spanId);
  if (!span) return;
  const startedAt = Date.now();
  appendRawLog(session, "system", "absence_summary_started", absenceLog(
    session,
    span,
    context.absenceTurns.map((turn) => turn.itemId),
    0,
    "composer_started",
  ));
  try {
    let draft = AbsenceSummaryDraftSchema.parse(await dependencies.compose(context));
    assertAbsenceCurrent(session, epoch, spanId);
    const review = AbsenceSummaryReviewSchema.parse(
      await dependencies.review(context, draft),
    );
    assertAbsenceCurrent(session, epoch, spanId);
    if (!review.publishable) {
      draft = AbsenceSummaryDraftSchema.parse(await dependencies.compose(
        context,
        review.revisionInstructions,
      ));
      assertAbsenceCurrent(session, epoch, spanId);
    }
    span.summary = sanitizeAbsenceSummary(context, draft, false);
    span.status = "completed";
    span.errorMessage = null;
    touchSession(session);
    appendRawLog(session, "system", "absence_summary_completed", absenceLog(
      session,
      span,
      span.summary.sourceItemIds,
      Date.now() - startedAt,
      review.publishable ? "reviewed_and_published" : "single_revision_published",
    ));
  } catch (error) {
    if (session.absenceEpoch !== epoch) return;
    const current = session.absenceSpans.find((candidate) => candidate.id === spanId);
    if (!current) return;
    current.summary = fallbackAbsenceSummary(context);
    current.status = "completed";
    current.errorMessage = "AI 상세 요약에 실패해 수업 기록 기반 요약을 표시합니다.";
    touchSession(session);
    appendRawLog(session, "error", "absence_summary_failed", absenceLog(
      session,
      current,
      current.summary.sourceItemIds,
      Date.now() - startedAt,
      error instanceof Error ? error.message : "unknown_absence_summary_error",
    ));
    recordSessionError(session, "absence_summary_generation", error, {
      absenceSpanId: spanId,
      fromSequence: context.startedAtSequence + 1,
      throughSequence: context.endedAtSequence,
    });
  }
}

function sanitizeAbsenceSummary(
  context: AbsenceSummaryContext,
  draft: AbsenceSummaryDraft,
  fallback: boolean,
): AbsenceSummary {
  const allowedItems = new Set(context.absenceTurns.map((turn) => turn.itemId));
  const allowedNotes = new Set(context.relatedNotes.map((note) => note.id));
  const allowedPages = new Set([
    ...(context.materialKnowledge?.outline.flatMap((topic) => topic.sourcePages) ?? []),
    ...context.relatedNotes.flatMap((note) => note.sourcePages),
  ]);
  return AbsenceSummarySchema.parse({
    ...draft,
    sourceItemIds: Array.from(new Set(draft.sourceItemIds.filter((id) => allowedItems.has(id)))),
    sourceNoteIds: Array.from(new Set(draft.sourceNoteIds.filter((id) => allowedNotes.has(id)))),
    sourcePages: Array.from(new Set(draft.sourcePages.filter((page) => allowedPages.has(page)))),
    generatedAt: new Date().toISOString(),
    fallback,
  });
}

export function fallbackAbsenceSummary(context: AbsenceSummaryContext): AbsenceSummary {
  const learningTurns = context.absenceTurns.filter((turn) =>
    turn.text.trim().length >= 10 &&
    !/(출석|마이크|화면|잠시\s*쉬|휴식|잡담|소리.*들리)/u.test(turn.text)
  );
  const noteSections = context.relatedNotes.flatMap((note) => note.sections.map((section) => ({
    title: `${note.title} · ${section.heading}`,
    explanation: section.items.map((item) => item.text).join(" "),
    keyPoints: section.items.map((item) => item.text).slice(0, 5),
  })));
  const transcriptSections = learningTurns.length > 0 ? [{
    title: "부재 중 수업 대본",
    explanation: learningTurns.map((turn) => turn.text).join(" "),
    keyPoints: learningTurns.slice(0, 8).map((turn) => turn.text),
  }] : [];
  const hasContent = noteSections.length > 0 || transcriptSections.length > 0;
  return sanitizeAbsenceSummary(context, {
    overview: hasContent
      ? `자리 비운 동안 ${context.absenceTurns.length}개의 발화가 기록되었습니다. 아래 내용은 모델 보충 없이 필기와 원문에서 가져왔습니다.`
      : "자리 비운 동안 새롭게 정리할 수업다운 내용이 확인되지 않았습니다.",
    detailedSections: [...noteSections, ...transcriptSections].slice(0, 12),
    importantPoints: context.relatedNotes.flatMap((note) => note.sections.flatMap(
      (section) => section.items.filter((item) => item.importance !== "normal").map((item) => item.text),
    )).slice(0, 8),
    currentLecturePosition: context.currentLecturePosition,
    suggestedReviewQuestions: hasContent
      ? ["부재 중 설명된 핵심 내용을 자신의 말로 다시 설명할 수 있나요?"]
      : [],
    sourceItemIds: learningTurns.map((turn) => turn.itemId),
    sourceNoteIds: context.relatedNotes.map((note) => note.id),
    sourcePages: context.relatedNotes.flatMap((note) => note.sourcePages),
  }, true);
}

export function completePendingAbsencesWithFallback(session: LectureSession): void {
  for (const span of session.absenceSpans) {
    if (span.status !== "summarizing" || span.endedAt === null || span.endedAtSequence === null) {
      continue;
    }
    span.summary = fallbackAbsenceSummary(buildAbsenceContext(session, span));
    span.status = "completed";
    span.errorMessage = "종료 시간 제한으로 수업 기록 기반 요약을 표시합니다.";
  }
  touchSession(session);
}

function activeAbsence(session: LectureSession): AbsenceSpan | undefined {
  return session.absenceSpans.find((span) => span.status === "active");
}

function assertAbsenceCurrent(
  session: LectureSession,
  epoch: number,
  spanId: string,
): void {
  if (
    session.absenceEpoch !== epoch ||
    !session.absenceSpans.some((span) => span.id === spanId)
  ) throw new Error("ABSENCE_JOB_STALE");
}

function absenceLog(
  session: LectureSession,
  span: AbsenceSpan,
  sourceItemIds: string[],
  durationMs: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    questionId: null,
    absenceSpanId: span.id,
    sourceItemIds,
    durationMs,
    reason,
  };
}
