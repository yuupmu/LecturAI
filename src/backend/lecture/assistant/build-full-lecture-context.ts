import type {
  LectureAssistantMode,
  LectureNote,
  LectureSession,
  MaterialKnowledge,
  TranscriptSelectionContext,
} from "../../schemas";

export interface FullLectureAssistantContext {
  mode: LectureAssistantMode;
  snapshotSequence: number;
  instruction: string;
  materialKnowledge: MaterialKnowledge | null;
  fullTranscript: Array<{
    itemId: string;
    sequence: number;
    text: string;
    receivedAt: string;
  }>;
  currentNote: LectureNote | null;
  question: string | null;
  selection: TranscriptSelectionContext | null;
}

interface BuildFullLectureContextInput {
  mode: LectureAssistantMode;
  snapshotSequence: number;
  question: string | null;
  selection: TranscriptSelectionContext | null;
}

// This deliberately performs no retrieval, relevance scoring, summarization,
// or compaction. The snapshot boundary is the only transcript filter.
export function buildFullLectureContext(
  session: LectureSession,
  input: BuildFullLectureContextInput,
): FullLectureAssistantContext {
  const fullTranscript = session.transcripts
    .filter((transcript) => transcript.sequence <= input.snapshotSequence)
    .sort(
      (left, right) => left.sequence - right.sequence ||
        left.receivedAt.localeCompare(right.receivedAt),
    )
    .map((transcript) => ({
      itemId: transcript.itemId,
      sequence: transcript.sequence,
      text: transcript.text,
      receivedAt: transcript.receivedAt,
    }));

  return {
    mode: input.mode,
    snapshotSequence: input.snapshotSequence,
    instruction: session.instruction,
    materialKnowledge: hasMaterialKnowledge(session.materialKnowledge)
      ? session.materialKnowledge
      : null,
    fullTranscript,
    currentNote: selectCurrentNote(session),
    question: input.question,
    selection: input.selection,
  };
}

function hasMaterialKnowledge(material: MaterialKnowledge): boolean {
  return Boolean(
    material.title ||
      material.summary ||
      material.outline.length > 0 ||
      material.terminology.length > 0,
  );
}

function selectCurrentNote(session: LectureSession): LectureNote | null {
  if (session.noteGeneration.currentNote) {
    return session.noteGeneration.currentNote;
  }
  if (session.noteGeneration.finalNote) {
    return session.noteGeneration.finalNote;
  }
  return [...session.lectureNotes].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  )[0] ?? null;
}
