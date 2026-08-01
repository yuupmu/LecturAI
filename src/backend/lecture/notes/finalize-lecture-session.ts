import { appendRawLog } from "../../logs/raw-log";
import { recordSessionError } from "../../logs/error-log";
import { generateReview } from "../../review/generate-review";
import type { LectureSession, Review } from "../../schemas";
import { touchSession } from "../../session-store";
import {
  closeActiveAbsenceForFinalization,
  completePendingAbsencesWithFallback,
  type AbsenceDependencies,
} from "../absence/absence-pipeline";
import { clearActivityTimer } from "../activity/lecture-activity-controller";
import {
  completePendingMissedFlowsWithFallback,
} from "../missed-flow/missed-flow-pipeline";
import {
  clearAutomaticNoteSchedule,
  runFinalNoteGeneration,
  type NoteGenerationDependencies,
} from "./cumulative-note-pipeline";

export interface FinalizationDependencies {
  noteDependencies?: NoteGenerationDependencies;
  generateReview?: (session: LectureSession) => Promise<Review>;
  absenceDependencies?: AbsenceDependencies;
  concurrentTaskTimeoutMs?: number;
}

export function finalizeLectureSession(
  session: LectureSession,
  dependencies: FinalizationDependencies = {},
): Promise<void> {
  if (session.status === "ended" || session.status === "finalizing") {
    return session.finalizationChain;
  }
  const endingReason = session.activityState.endingCandidate?.kind ??
    "existing_finish_lesson_path";
  session.status = "finalizing";
  clearActivityTimer(session);
  session.activityState.endingCandidate = null;
  session.activityState.inactivityCandidate = null;
  session.noteGeneration.pendingManualRequest = false;
  clearAutomaticNoteSchedule(session, "session_finalizing");
  completePendingMissedFlowsWithFallback(session);
  touchSession(session);
  appendRawLog(session, "system", "session_finalizing", {
    sessionId: session.id,
    lectureRevision: session.noteGeneration.revision,
    sourceItemIds: [],
    durationMs: 0,
    reason: endingReason,
  });

  const finalization = (async () => {
    try {
      const absencePromise = closeActiveAbsenceForFinalization(
        session,
        dependencies.absenceDependencies,
      );
      await session.noteGenerationChain.catch(() => undefined);
      await runFinalNoteGeneration(session, dependencies.noteDependencies);
      await settleConcurrentSessionWork(
        session,
        Promise.allSettled([session.questionChain, absencePromise]).then(() => undefined),
        dependencies.concurrentTaskTimeoutMs ?? 20_000,
      );
      session.review = await (dependencies.generateReview ?? generateReview)(session);
      session.status = "ended";
      touchSession(session);
      appendRawLog(session, "system", "session_ended", {
        sessionId: session.id,
        lectureRevision: session.noteGeneration.revision,
        sourceItemIds: session.noteGeneration.finalNote?.sourceItemIds ?? [],
        durationMs: 0,
        reason: session.noteGeneration.finalNote
          ? "final_note_and_review_completed"
          : "review_completed_without_meaningful_note",
      });
    } catch (error) {
      recordSessionError(session, "session_finalization", error);
      session.status = "ended";
      touchSession(session);
      appendRawLog(session, "system", "session_finalization_failed", {
        sessionId: session.id,
        lectureRevision: session.noteGeneration.revision,
        sourceItemIds: [],
        durationMs: 0,
        reason: error instanceof Error ? error.message : "unknown_finalization_error",
      });
    }
  })();
  session.finalizationChain = finalization;
  return finalization;
}

async function settleConcurrentSessionWork(
  session: LectureSession,
  work: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!timedOut) return;

  session.questionEpoch += 1;
  session.absenceEpoch += 1;
  for (const question of session.questions) {
    if (question.status === "queued" || question.status === "answering") {
      question.status = "failed";
      question.answer = null;
      question.errorMessage = "수업 종료 중 답변 시간이 초과되었습니다. 질문을 다시 확인해 주세요.";
    }
  }
  completePendingAbsencesWithFallback(session);
  appendRawLog(session, "system", "session_concurrent_work_timed_out", {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    sourceItemIds: [],
    durationMs: timeoutMs,
    reason: "question_or_absence_timeout",
  });
}
