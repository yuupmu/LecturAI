import { recordSessionError } from "../logs/error-log";
import { appendRawLog } from "../logs/raw-log";
import type { LectureSession, Transcript } from "../schemas";
import { applyLectureStatePatch } from "./apply-lecture-state-patch";
import { buildLectureContext } from "./build-lecture-context";
import { interpretLectureWindow } from "./interpret-lecture-window";
import { queueStructuredNote } from "./notes/note-pipeline";

async function interpretOneTranscript(
  session: LectureSession,
  transcript: Transcript,
): Promise<void> {
  const startedAt = Date.now();
  const context = buildLectureContext(session, transcript);
  appendRawLog(session, "system", "lecture_context_built", {
    sessionId: session.id,
    baseRevision: context.baseRevision,
    currentRevision: session.lectureMemory.revision,
    sourceItemIds: context.allowedSourceItemIds,
    unitId: session.lectureMemory.currentUnit?.id ?? null,
    durationMs: Date.now() - startedAt,
    reason: `${context.recentTranscripts.length}_recent_transcripts`,
  });

  const patch = await interpretLectureWindow(session, context);
  appendRawLog(session, "system", "lecture_patch_received", {
    sessionId: session.id,
    baseRevision: patch.baseRevision,
    currentRevision: session.lectureMemory.revision,
    sourceItemIds: [transcript.itemId],
    unitId: session.lectureMemory.currentUnit?.id ?? null,
    durationMs: Date.now() - startedAt,
    reason: patch.unitDecision,
  });
  const result = applyLectureStatePatch(session, patch, context);
  if (result.finalizedUnit) queueStructuredNote(session, result.finalizedUnit);
}

// Every session owns one ordered interpreter chain. Context and revision are
// captured only when a job reaches the head, so rapid transcripts are not all
// discarded as stale while transcript persistence remains immediate.
export function queueLectureInterpretation(
  session: LectureSession,
  transcript: Transcript,
): void {
  const job = async () => {
    try {
      await interpretOneTranscript(session, transcript);
    } catch (error) {
      recordSessionError(session, "lecture_interpreter", error, {
        itemId: transcript.itemId,
        sequence: transcript.sequence,
        revision: session.lectureMemory.revision,
      });
      appendRawLog(session, "system", "lecture_patch_rejected", {
        sessionId: session.id,
        baseRevision: session.lectureMemory.revision,
        currentRevision: session.lectureMemory.revision,
        sourceItemIds: [transcript.itemId],
        unitId: session.lectureMemory.currentUnit?.id ?? null,
        durationMs: 0,
        reason: error instanceof Error ? error.message : "interpreter_failed",
      });
    }
  };
  session.interpreterChain = session.interpreterChain
    .catch(() => undefined)
    .then(job);
}
