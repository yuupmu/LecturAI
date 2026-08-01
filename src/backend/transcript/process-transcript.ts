import { randomUUID } from "node:crypto";
import { processLectureActivity } from "../lecture/activity/lecture-activity-controller";
import { startAutomaticNoteSchedule } from "../lecture/notes/cumulative-note-pipeline";
import { queueProfessorStyleUpdate } from "../lecture/style/professor-style-profile";
import { scheduleDeferredQuestionChecks } from "../lecture/understanding/deferred-question-pipeline";
import { appendRawLog } from "../logs/raw-log";
import {
  TranscriptInputSchema,
  TranscriptSchema,
  type AgentActionName,
  type LectureSession,
  type TranscriptInput,
} from "../schemas";
import { touchSession } from "../session-store";
import { scheduleTranslation } from "../translation/translation-scheduler";

// Transcript persistence is the durable boundary. Note generation is driven by
// a server checkpoint, a manual request, or finalization—not by each transcript.
export async function processTranscript(
  session: LectureSession,
  untrustedInput: TranscriptInput,
): Promise<{ action: AgentActionName; duplicate: boolean; version: number }> {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_TRANSCRIPTS");
  }
  const input = TranscriptInputSchema.parse(untrustedInput);
  if (session.processedItemIds.has(input.itemId)) {
    return { action: "none", duplicate: true, version: session.version };
  }

  const transcript = TranscriptSchema.parse({
    id: randomUUID(),
    itemId: input.itemId,
    sequence: input.sequence,
    text: input.text,
    source: input.source === "realtime" ? "realtime" : "manual",
    receivedAt: input.receivedAt,
    startedAtMs: input.startedAtMs ?? null,
    endedAtMs: input.endedAtMs ?? null,
    matchedSlidePages: [],
    matchedSlidePage: session.currentSlidePage,
    slideConfidence: 0,
  });

  session.processedItemIds.add(input.itemId);
  session.transcripts = [...session.transcripts, transcript].sort(
    (left, right) => left.sequence - right.sequence ||
      left.receivedAt.localeCompare(right.receivedAt),
  );
  session.lectureRevision += 1;
  if (session.status === "ready") session.status = "listening";
  touchSession(session);
  appendRawLog(session, "system", "transcript_saved", {
    sessionId: session.id,
    baseRevision: session.lectureMemory.revision,
    currentRevision: session.lectureMemory.revision,
    sourceItemIds: [transcript.itemId],
    unitId: session.lectureMemory.currentUnit?.id ?? null,
    durationMs: 0,
    reason: "immutable_transcript_appended",
  });
  processLectureActivity(session, transcript);
  queueProfessorStyleUpdate(session);
  startAutomaticNoteSchedule(session);
  scheduleTranslation(session, transcript);
  // This only queues one batched check after five new turns. Transcript
  // persistence and automatic note scheduling never wait for the model.
  scheduleDeferredQuestionChecks(session);
  return { action: "none", duplicate: false, version: session.version };
}
