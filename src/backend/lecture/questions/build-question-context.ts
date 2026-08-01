import type {
  LectureNote,
  LectureSession,
  MaterialKnowledge,
  ProfessorStyleProfile,
  TranscriptSelectionContext,
  TranslationTargetLanguage,
} from "../../schemas";

export interface MaterialContextExcerpt {
  id: string;
  label: string;
  text: string;
  sourcePage: number;
}

export interface StructuredNoteExcerpt {
  noteId: string;
  label: string;
  text: string;
  sourceItemIds: string[];
  sourcePages: number[];
}

export interface TranscriptExcerpt {
  itemId: string;
  sequence: number;
  text: string;
  receivedAt: string;
}

export interface OpenUnitExcerpt {
  unitId: string;
  title: string;
  text: string;
  sourceItemIds: string[];
  sourcePages: number[];
}

export interface LectureQuestionContext {
  question: string;
  selection: (TranscriptSelectionContext & { sourceText: string }) | null;
  answerLanguage: TranslationTargetLanguage | null;
  lectureRevision: number;
  snapshotSequence: number;
  instruction: string;
  materialContext: MaterialContextExcerpt[];
  noteContext: StructuredNoteExcerpt[];
  transcriptContext: TranscriptExcerpt[];
  openUnitContext: OpenUnitExcerpt | null;
  professorStyle: ProfessorStyleProfile | null;
}

export function buildQuestionContext(
  session: LectureSession,
  question: string,
  snapshotSequence: number,
  lectureRevision: number,
  selection: TranscriptSelectionContext | null = null,
  answerLanguage: TranslationTargetLanguage | null = null,
): LectureQuestionContext {
  const allTranscripts = session.transcripts
    .filter((turn) => turn.sequence <= snapshotSequence)
    .sort((left, right) => left.sequence - right.sequence);
  const selectedTranscripts = selection
    ? allTranscripts.filter((turn) => selection.sourceItemIds.includes(turn.itemId))
    : [];
  const questionTerms = queryTerms(question);
  const translatedMatchItemIds = selectTranslatedMatchItemIds(
    session,
    answerLanguage,
    questionTerms,
  );
  const translatedMatches = allTranscripts.filter((turn) =>
    translatedMatchItemIds.has(turn.itemId)
  );
  // The displayed translation may use terms that do not appear verbatim in
  // source-language material. Include the mapped source turns in relevance
  // terms and pin them in the snapshot so every translated selection remains
  // grounded in the original lecture evidence.
  const terms = queryTerms([
    question,
    ...selectedTranscripts.map((turn) => turn.text),
    ...translatedMatches.map((turn) => turn.text),
  ].join("\n"));
  const transcriptIndexes = selectTranscriptIndexes(
    allTranscripts,
    terms,
    new Set(selectedTranscripts.map((turn) => turn.itemId)),
  );
  const notes = snapshotNotes(session);

  return {
    question,
    selection: selection
      ? {
          ...selection,
          sourceText: selectedTranscripts.map((turn) => turn.text).join("\n"),
        }
      : null,
    answerLanguage,
    lectureRevision,
    snapshotSequence,
    instruction: session.instruction,
    materialContext: selectMaterialContext(session.materialKnowledge, terms),
    noteContext: selectNoteContext(notes, terms),
    transcriptContext: transcriptIndexes.map((index) => {
      const turn = allTranscripts[index];
      return {
        itemId: turn.itemId,
        sequence: turn.sequence,
        text: turn.text,
        receivedAt: turn.receivedAt,
      };
    }),
    openUnitContext: selectOpenUnitContext(session, terms),
    professorStyle: session.professorStyleProfile
      ? structuredClone(session.professorStyleProfile)
      : null,
  };
}

function selectTranslatedMatchItemIds(
  session: LectureSession,
  targetLanguage: TranslationTargetLanguage | null,
  terms: string[],
): Set<string> {
  if (!targetLanguage || terms.length === 0) return new Set();
  return new Set(
    session.translations
      .filter(
        (translation) =>
          translation.status === "complete" &&
          translation.translatedText !== null &&
          translation.targetLanguage === targetLanguage &&
          translation.settingsRevision === session.translationSettings.revision,
      )
      .map((translation) => ({
        itemId: translation.itemId,
        score: relevanceScore(translation.translatedText as string, terms),
        sequence: translation.sequence,
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || right.sequence - left.sequence)
      .slice(0, 8)
      .map((match) => match.itemId),
  );
}

function snapshotNotes(session: LectureSession): LectureNote[] {
  const candidates = [
    session.noteGeneration.finalNote,
    session.noteGeneration.currentNote,
    ...session.lectureNotes,
  ].filter((note): note is LectureNote => note !== null);
  return Array.from(new Map(candidates.map((note) => [note.id, note])).values())
    .map((note) => structuredClone(note));
}

function selectMaterialContext(
  material: MaterialKnowledge,
  terms: string[],
): MaterialContextExcerpt[] {
  const entries: MaterialContextExcerpt[] = [];
  for (const topic of material.outline) {
    const add = (id: string, label: string, text: string, sourcePage: number) => {
      entries.push({ id, label: `${topic.title} · ${label}`, text, sourcePage });
    };
    for (const item of [
      ...topic.definitions,
      ...topic.conditions,
      ...topic.formulas,
      ...topic.comparisons,
      ...topic.examples,
      ...topic.warnings,
    ]) {
      add(item.id, "자료", item.text, item.sourcePage);
    }
    for (const process of topic.processes) {
      add(
        process.id,
        process.title ?? "과정",
        process.steps.map((step) => `${step.order}. ${step.text}`).join(" "),
        process.sourcePage,
      );
    }
    if (topic.summary.trim() && topic.sourcePages[0]) {
      add(`topic:${topic.id}`, "요약", topic.summary, topic.sourcePages[0]);
    }
  }
  return rank(entries, terms, (entry) => `${entry.label} ${entry.text}`).slice(0, 10);
}

function selectNoteContext(
  notes: LectureNote[],
  terms: string[],
): StructuredNoteExcerpt[] {
  const entries = notes.flatMap((note) => note.sections.map((section) => ({
    noteId: note.id,
    label: `${note.status === "final" ? "최종 필기" : "실시간 필기"} · ${note.title} · ${section.heading}`,
    text: section.items.map((item, index) =>
      `${section.layout === "steps" ? `${index + 1}.` : "-"} ${item.text}`
    ).join("\n"),
    sourceItemIds: Array.from(new Set(section.items.flatMap((item) => item.sourceItemIds))),
    sourcePages: Array.from(new Set(section.items.flatMap((item) => item.sourcePages))),
  })));
  return rank(entries, terms, (entry) => `${entry.label} ${entry.text}`).slice(0, 10);
}

function selectOpenUnitContext(
  session: LectureSession,
  terms: string[],
): OpenUnitExcerpt | null {
  const unit = session.lectureMemory.currentUnit;
  if (!unit || unit.provisionalKnowledge.length === 0) return null;
  const text = unit.provisionalKnowledge.map((knowledge) => knowledge.text).join("\n");
  if (terms.length > 0 && relevanceScore(`${unit.workingTitle ?? ""} ${text}`, terms) === 0) {
    return null;
  }
  return {
    unitId: unit.id,
    title: unit.workingTitle ?? "현재 열린 단원",
    text,
    sourceItemIds: Array.from(new Set(unit.provisionalKnowledge.flatMap(
      (knowledge) => knowledge.sourceItemIds,
    ))),
    sourcePages: Array.from(new Set(unit.provisionalKnowledge.flatMap(
      (knowledge) => knowledge.sourcePages,
    ))),
  };
}

function selectTranscriptIndexes(
  transcripts: LectureSession["transcripts"],
  terms: string[],
  requiredItemIds: ReadonlySet<string> = new Set(),
): number[] {
  const scored = transcripts.map((turn, index) => ({
    index,
    score: relevanceScore(turn.text, terms),
  })).filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, 8);
  const indexes = new Set<number>();
  const requiredIndexes = new Set<number>();
  for (const [index, transcript] of transcripts.entries()) {
    if (requiredItemIds.has(transcript.itemId)) {
      indexes.add(index);
      requiredIndexes.add(index);
    }
  }
  for (const match of scored) {
    for (let index = Math.max(0, match.index - 2); index <= Math.min(transcripts.length - 1, match.index + 2); index += 1) {
      indexes.add(index);
    }
  }
  const recentStart = Math.max(0, transcripts.length - 8);
  for (let index = recentStart; index < transcripts.length; index += 1) indexes.add(index);
  const ordered = [...indexes].sort((left, right) => left - right);
  if (ordered.length <= 32) return ordered;

  const required = ordered.filter((index) => requiredIndexes.has(index));
  if (required.length >= 32) return required.slice(0, 32);
  const optional = ordered.filter((index) => !requiredIndexes.has(index));
  return [...required, ...optional.slice(-(32 - required.length))]
    .sort((left, right) => left - right);
}

function rank<T>(entries: T[], terms: string[], text: (entry: T) => string): T[] {
  return entries.map((entry, index) => ({
    entry,
    index,
    score: relevanceScore(text(entry), terms),
  })).filter((candidate) => candidate.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.entry);
}

function queryTerms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return Array.from(new Set(words.filter((word) => word.length >= 2 && !QUESTION_STOP_WORDS.has(word))));
}

function relevanceScore(value: string, terms: string[]): number {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? Math.max(1, term.length / 2) : 0), 0);
}

const QUESTION_STOP_WORDS = new Set([
  "왜", "무엇", "어떻게", "인가요", "있나요", "설명", "해주세요", "대해",
  "이것", "그것", "내용", "수업", "교수님",
]);
