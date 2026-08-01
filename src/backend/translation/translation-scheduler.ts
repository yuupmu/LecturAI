import { randomUUID } from "node:crypto";
import { appendRawLog } from "../logs/raw-log";
import {
  LiveTranslationSegmentSchema,
  type LectureSession,
  type Transcript,
  type TranslationTargetLanguage,
} from "../schemas";
import { touchSession } from "../session-store";
import {
  translateTranscript,
  type TranslateTranscriptInput,
} from "./translate-transcript";

const TRANSLATION_FAILURE_MESSAGE =
  "방금 자막을 번역하지 못했습니다. 다음 발화부터 계속 번역합니다.";

export interface TranslationSchedulerOptions {
  translate?: (
    input: TranslateTranscriptInput,
  ) => Promise<{ translatedText: string }>;
}

/** Each caption is translated directly by AI and does not block later captions. */
export function scheduleTranslation(
  session: LectureSession,
  transcript: Transcript,
  options: TranslationSchedulerOptions = {},
): void {
  if (
    !session.translationSettings.enabled ||
    !session.translationSettings.targetLanguage
  ) {
    return;
  }

  const targetLanguage = session.translationSettings.targetLanguage;
  const settingsRevision = session.translationSettings.revision;
  const translationKey =
    `${transcript.itemId}:${targetLanguage}:${settingsRevision}`;
  if (session.processedTranslationKeys.has(translationKey)) return;
  session.processedTranslationKeys.add(translationKey);

  const segment = LiveTranslationSegmentSchema.parse({
    id: randomUUID(),
    itemId: transcript.itemId,
    sequence: transcript.sequence,
    sourceText: transcript.text,
    translatedText: null,
    targetLanguage,
    status: "translating",
    slidePage: transcript.matchedSlidePage ?? session.currentSlidePage,
    settingsRevision,
    createdAt: Date.now(),
  });
  session.translations.push(segment);
  session.translations.sort((left, right) =>
    left.sequence - right.sequence || left.createdAt - right.createdAt
  );
  touchSession(session);

  const translationJob = async () => {
    if (!settingsStillCurrent(session, targetLanguage, settingsRevision)) {
      logDiscarded(session, transcript, targetLanguage, settingsRevision);
      return;
    }
    appendRawLog(session, "system", "translation_ai_request", {
      itemId: transcript.itemId,
      sequence: transcript.sequence,
      targetLanguage,
      settingsRevision,
    });

    try {
      const result = await (options.translate ?? translateTranscript)(
        buildTranslationInput(
          session,
          transcript,
          targetLanguage,
          settingsRevision,
        ),
      );
      if (!settingsStillCurrent(session, targetLanguage, settingsRevision)) {
        logDiscarded(session, transcript, targetLanguage, settingsRevision);
        return;
      }
      const current = findCurrentSegment(session, segment.id);
      if (!current) {
        logDiscarded(session, transcript, targetLanguage, settingsRevision);
        return;
      }

      current.translatedText = result.translatedText;
      current.status = "complete";
      current.completedAt = Date.now();
      delete current.errorMessage;
      touchSession(session);
      appendRawLog(session, "system", "translation_ai_result", {
        itemId: transcript.itemId,
        sequence: transcript.sequence,
        targetLanguage,
        settingsRevision,
      });
    } catch (error) {
      if (!settingsStillCurrent(session, targetLanguage, settingsRevision)) {
        logDiscarded(session, transcript, targetLanguage, settingsRevision);
        return;
      }
      const current = findCurrentSegment(session, segment.id);
      if (!current) return;
      current.status = "failed";
      current.errorMessage = TRANSLATION_FAILURE_MESSAGE;
      current.completedAt = Date.now();
      touchSession(session);
      appendRawLog(session, "system", "translation_ai_error", {
        itemId: transcript.itemId,
        sequence: transcript.sequence,
        targetLanguage,
        settingsRevision,
        reason: error instanceof Error ? error.message : "translation_failed",
      });
    }
  };

  // Start immediately; the UI still orders segments by transcript sequence.
  // Keep an aggregate promise solely for reset/tests.
  session.translationChain = Promise.all([
    session.translationChain.catch(() => undefined),
    translationJob(),
  ]).then(() => undefined);
}

function buildTranslationInput(
  session: LectureSession,
  transcript: Transcript,
  targetLanguage: TranslationTargetLanguage,
  settingsRevision: number,
): TranslateTranscriptInput {
  const slidePage = transcript.matchedSlidePage ?? session.currentSlidePage;
  const slide = session.slideMap.slides.find(
    (candidate) => candidate.page === slidePage,
  );
  return {
    text: transcript.text,
    targetLanguage,
    currentSlide: slide
      ? {
          title: slide.title,
          keyConcepts: slide.keyConcepts.slice(0, 8),
          keywords: slide.keywords.slice(0, 8),
        }
      : null,
    recentContext: session.transcripts
      .filter((candidate) => candidate.sequence < transcript.sequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-2)
      .map((candidate) => ({
        sequence: candidate.sequence,
        text: candidate.text,
      })),
    previousTranslations: session.translations
      .filter(
        (candidate) =>
          candidate.translatedText !== null &&
          candidate.status === "complete" &&
          candidate.sequence < transcript.sequence &&
          candidate.targetLanguage === targetLanguage &&
          candidate.settingsRevision === settingsRevision,
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-2)
      .map((candidate) => ({
        sourceText: candidate.sourceText,
        translatedText: candidate.translatedText as string,
      })),
  };
}

function findCurrentSegment(session: LectureSession, segmentId: string) {
  return session.translations.find((candidate) => candidate.id === segmentId);
}

function settingsStillCurrent(
  session: LectureSession,
  targetLanguage: TranslationTargetLanguage,
  settingsRevision: number,
): boolean {
  return session.translationSettings.enabled &&
    session.translationSettings.targetLanguage === targetLanguage &&
    session.translationSettings.revision === settingsRevision;
}

function logDiscarded(
  session: LectureSession,
  transcript: Transcript,
  targetLanguage: TranslationTargetLanguage,
  settingsRevision: number,
): void {
  appendRawLog(session, "system", "translation_discarded", {
    itemId: transcript.itemId,
    sequence: transcript.sequence,
    targetLanguage,
    settingsRevision,
    reason: "settings_changed",
  });
}
