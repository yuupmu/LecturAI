import type {
  LectureNote,
  LectureSession,
  MaterialKnowledge,
  NoteGenerationTrigger,
  Transcript,
} from "../../schemas";

export interface NoteGenerationContext {
  trigger: NoteGenerationTrigger;
  existingNote: LectureNote | null;
  contextOnlyTurns: Transcript[];
  newTurnsToProcess: Transcript[];
  materialKnowledge: MaterialKnowledge;
  snapshotSequence: number;
  lastProcessedSequence: number;
}

export function latestTranscriptSequence(session: LectureSession): number {
  return session.transcripts.reduce(
    (latest, transcript) => Math.max(latest, transcript.sequence),
    0,
  );
}

export function buildNoteGenerationContext(
  session: LectureSession,
  trigger: NoteGenerationTrigger,
  snapshotSequence: number,
  snapshotItemIds?: readonly string[],
): NoteGenerationContext {
  const lastProcessedSequence = session.noteGeneration.lastProcessedSequence;
  const processedItemIds = new Set(session.noteGeneration.processedItemIds);
  const snapshotItems = new Set(
    snapshotItemIds ?? session.transcripts
      .filter((turn) => turn.sequence <= snapshotSequence)
      .map((turn) => turn.itemId),
  );
  const newTurnsToProcess = session.transcripts.filter(
    (turn) =>
      snapshotItems.has(turn.itemId) &&
      !processedItemIds.has(turn.itemId) &&
      turn.text.trim().length > 0,
  );
  const firstNewSequence = newTurnsToProcess[0]?.sequence ?? snapshotSequence + 1;
  const contextOnlyTurns = session.transcripts
    .filter((turn) => turn.sequence < firstNewSequence)
    .slice(-5);

  return {
    trigger,
    existingNote: session.noteGeneration.currentNote,
    contextOnlyTurns,
    newTurnsToProcess,
    materialKnowledge: session.materialKnowledge,
    snapshotSequence,
    lastProcessedSequence,
  };
}

export function hasUnprocessedTranscript(session: LectureSession): boolean {
  const processedItemIds = new Set(session.noteGeneration.processedItemIds);
  return session.transcripts.some(
    (turn) => turn.text.trim().length > 0 && !processedItemIds.has(turn.itemId),
  );
}
