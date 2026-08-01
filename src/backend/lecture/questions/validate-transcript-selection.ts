import {
  TranscriptSelectionContextSchema,
  type LectureSession,
  type TranscriptSelectionContext,
} from "../../schemas";

export class InvalidQuestionTranscriptSelectionError extends Error {
  constructor(message = "선택한 대본 범위를 확인할 수 없습니다.") {
    super(message);
    this.name = "InvalidQuestionTranscriptSelectionError";
  }
}

/**
 * Confirms that a selection came from stored, finalized transcript content.
 * Translation text is never treated as a new source of truth: it must map to
 * completed translation segments and the original transcript item ids.
 */
export function validateQuestionTranscriptSelection(
  session: LectureSession,
  untrustedSelection: TranscriptSelectionContext,
  snapshotSequence: number,
): TranscriptSelectionContext {
  const selection = TranscriptSelectionContextSchema.parse(untrustedSelection);
  const normalizedSelectionText = normalizeSelectionText(selection.selectedText);
  if (normalizedSelectionText.length < 4) {
    throw new InvalidQuestionTranscriptSelectionError();
  }

  const sourceItemIds = Array.from(new Set(selection.sourceItemIds));
  if (sourceItemIds.length !== selection.sourceItemIds.length) {
    throw new InvalidQuestionTranscriptSelectionError();
  }
  const sourceSet = new Set(sourceItemIds);
  const sourceTranscripts = session.transcripts
    .filter(
      (transcript) =>
        sourceSet.has(transcript.itemId) &&
        transcript.sequence <= snapshotSequence,
    )
    .sort((left, right) => left.sequence - right.sequence);

  if (sourceTranscripts.length !== sourceItemIds.length) {
    throw new InvalidQuestionTranscriptSelectionError();
  }
  if (
    sourceTranscripts[0]?.sequence !== selection.startSequence ||
    sourceTranscripts.at(-1)?.sequence !== selection.endSequence
  ) {
    throw new InvalidQuestionTranscriptSelectionError();
  }

  if (selection.kind === "original") {
    if (selection.targetLanguage !== null || selection.translationIds.length > 0) {
      throw new InvalidQuestionTranscriptSelectionError();
    }
    const sourceText = sourceTranscripts.map((transcript) => transcript.text).join("\n");
    if (!normalizedTextIncludes(sourceText, normalizedSelectionText)) {
      throw new InvalidQuestionTranscriptSelectionError();
    }
  } else {
    validateTranslationSelection(
      session,
      selection,
      sourceTranscripts.map((transcript) => ({
        itemId: transcript.itemId,
        sequence: transcript.sequence,
      })),
      normalizedSelectionText,
    );
  }

  return TranscriptSelectionContextSchema.parse({
    ...selection,
    sourceItemIds,
  });
}

function validateTranslationSelection(
  session: LectureSession,
  selection: TranscriptSelectionContext,
  sourceTranscripts: Array<{ itemId: string; sequence: number }>,
  normalizedSelectionText: string,
): void {
  if (!selection.targetLanguage || selection.translationIds.length === 0) {
    throw new InvalidQuestionTranscriptSelectionError();
  }
  const translationIds = Array.from(new Set(selection.translationIds));
  if (
    translationIds.length !== selection.translationIds.length ||
    translationIds.length !== sourceTranscripts.length ||
    !session.translationSettings.enabled ||
    session.translationSettings.targetLanguage !== selection.targetLanguage
  ) {
    throw new InvalidQuestionTranscriptSelectionError();
  }

  const translationsById = new Map(
    session.translations.map((translation) => [translation.id, translation]),
  );
  const translationText: string[] = [];
  for (const [index, source] of sourceTranscripts.entries()) {
    const translation = translationsById.get(translationIds[index]);
    if (
      !translation ||
      translation.status !== "complete" ||
      !translation.translatedText ||
      translation.itemId !== source.itemId ||
      translation.sequence !== source.sequence ||
      translation.targetLanguage !== selection.targetLanguage ||
      translation.settingsRevision !== session.translationSettings.revision
    ) {
      throw new InvalidQuestionTranscriptSelectionError();
    }
    translationText.push(translation.translatedText);
  }
  if (!normalizedTextIncludes(translationText.join("\n"), normalizedSelectionText)) {
    throw new InvalidQuestionTranscriptSelectionError();
  }
}

function normalizedTextIncludes(source: string, target: string): boolean {
  return normalizeSelectionText(source).includes(target);
}

function normalizeSelectionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}
