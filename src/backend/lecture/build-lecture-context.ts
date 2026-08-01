import type {
  CompletedLectureUnit,
  LectureSession,
  MaterialTopic,
  Transcript,
} from "../schemas";

export interface LectureInterpreterContext {
  instruction: string;
  baseRevision: number;
  newTranscript: Transcript;
  recentTranscripts: Transcript[];
  currentUnit: LectureSession["lectureMemory"]["currentUnit"];
  recentCompletedUnits: Array<{
    id: string;
    title: string;
    summary: string;
  }>;
  materialOutline: Array<{
    id: string;
    title: string;
    summary: string;
    sourcePages: number[];
  }>;
  relevantMaterialTopics: MaterialTopic[];
  allowedSourceItemIds: string[];
  allowedSourcePages: number[];
}

function completedSummary(unit: CompletedLectureUnit): string {
  return unit.knowledgeUnits
    .slice(0, 5)
    .map((knowledge) => knowledge.text)
    .join(" ");
}

function searchableTopicText(topic: MaterialTopic): string {
  return [
    topic.title,
    topic.summary,
    ...topic.definitions.map((item) => item.text),
    ...topic.conditions.map((item) => item.text),
    ...topic.formulas.map((item) => item.text),
    ...topic.comparisons.map((item) => item.text),
    ...topic.examples.map((item) => item.text),
    ...topic.warnings.map((item) => item.text),
    ...topic.processes.flatMap((process) => process.steps.map((step) => step.text)),
  ].join(" ").toLocaleLowerCase();
}

function relevantTopics(
  session: LectureSession,
  transcripts: Transcript[],
): MaterialTopic[] {
  const words = Array.from(new Set(
    transcripts
      .map((transcript) => transcript.text)
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}()+]+/u)
      .filter((word) => word.length >= 2),
  ));
  if (words.length === 0) return [];
  return session.materialKnowledge.outline
    .filter((topic) => {
      const materialText = searchableTopicText(topic);
      return words.some((word) => materialText.includes(word));
    })
    .slice(0, 4);
}

export function buildLectureContext(
  session: LectureSession,
  newTranscript: Transcript,
): LectureInterpreterContext {
  const transcriptIndex = session.transcripts.findIndex(
    (candidate) => candidate.id === newTranscript.id,
  );
  const throughCurrent = session.transcripts.slice(
    0,
    transcriptIndex < 0 ? session.transcripts.length : transcriptIndex + 1,
  );
  const recentByCount = throughCurrent.slice(-20);
  const newestTimestamp = Date.parse(newTranscript.receivedAt);
  const recentTranscripts = Number.isFinite(newestTimestamp)
    ? recentByCount.filter((transcript) => {
        const timestamp = Date.parse(transcript.receivedAt);
        return !Number.isFinite(timestamp) || newestTimestamp - timestamp <= 120_000;
      })
    : recentByCount;
  const relevantMaterialTopics = relevantTopics(session, recentTranscripts);

  return {
    instruction: session.instruction,
    baseRevision: session.lectureMemory.revision,
    newTranscript,
    recentTranscripts,
    currentUnit: session.lectureMemory.currentUnit,
    recentCompletedUnits: session.lectureMemory.completedUnits
      .slice(-2)
      .map((unit) => ({
        id: unit.id,
        title: unit.title,
        summary: completedSummary(unit),
      })),
    materialOutline: session.materialKnowledge.outline.map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      sourcePages: topic.sourcePages,
    })),
    relevantMaterialTopics,
    allowedSourceItemIds: recentTranscripts.map((transcript) => transcript.itemId),
    allowedSourcePages: Array.from(new Set(
      session.materialKnowledge.outline.flatMap((topic) => topic.sourcePages),
    )).sort((left, right) => left - right),
  };
}
