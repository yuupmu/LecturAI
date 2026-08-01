import type {
  AbsenceSpan,
  LectureNote,
  LectureSession,
  MaterialKnowledge,
  Transcript,
} from "../../schemas";

export interface AbsenceSummaryContext {
  spanId: string;
  startedAt: string;
  endedAt: string;
  startedAtSequence: number;
  endedAtSequence: number;
  beforeContext: Transcript[];
  absenceTurns: Transcript[];
  afterContext: Transcript[];
  relatedNotes: LectureNote[];
  materialKnowledge: MaterialKnowledge | null;
  currentLecturePosition: string;
}

export function buildAbsenceContext(
  session: LectureSession,
  span: AbsenceSpan,
): AbsenceSummaryContext {
  if (span.endedAtSequence === null || span.endedAt === null) {
    throw new Error("ABSENCE_SPAN_NOT_ENDED");
  }
  const absenceTurns = session.transcripts.filter((turn) =>
    turn.sequence > span.startedAtSequence &&
    turn.sequence <= span.endedAtSequence!
  );
  const absenceIds = new Set(absenceTurns.map((turn) => turn.itemId));
  const notes = [
    session.noteGeneration.finalNote,
    session.noteGeneration.currentNote,
    ...session.lectureNotes,
  ].filter((note): note is LectureNote => note !== null);
  const relatedNotes = Array.from(new Map(notes.map((note) => [note.id, note])).values())
    .filter((note) => note.sourceItemIds.some((itemId) => absenceIds.has(itemId)))
    .map((note) => structuredClone(note));

  return {
    spanId: span.id,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    startedAtSequence: span.startedAtSequence,
    endedAtSequence: span.endedAtSequence,
    beforeContext: session.transcripts
      .filter((turn) => turn.sequence <= span.startedAtSequence)
      .slice(-5)
      .map((turn) => structuredClone(turn)),
    absenceTurns: absenceTurns.map((turn) => structuredClone(turn)),
    afterContext: session.transcripts
      .filter((turn) => turn.sequence > span.endedAtSequence!)
      .slice(0, 3)
      .map((turn) => structuredClone(turn)),
    relatedNotes,
    materialKnowledge: hasMaterial(session.materialKnowledge)
      ? structuredClone(session.materialKnowledge)
      : null,
    currentLecturePosition: session.noteGeneration.currentNote?.sections.at(-1)?.heading ??
      session.lectureMemory.currentUnit?.workingTitle ??
      session.noteGeneration.currentNote?.title ??
      "복귀 시점의 수업 위치를 대본에서 확인하세요.",
  };
}

function hasMaterial(material: MaterialKnowledge): boolean {
  return Boolean(material.title || material.summary || material.outline.length);
}
