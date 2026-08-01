import assert from "node:assert/strict";
import {
  createLectureQuestion,
  type QuestionDependencies,
} from "../src/backend/lecture/questions/question-pipeline";
import {
  InvalidQuestionTranscriptSelectionError,
} from "../src/backend/lecture/questions/validate-transcript-selection";
import {
  LectureAnswerDraftSchema,
  LectureAnswerReviewSchema,
  LiveTranslationSegmentSchema,
  TranscriptSchema,
} from "../src/backend/schemas";
import { createPreparingSession } from "../src/backend/session-store";
import { updateTranslationSettings } from "../src/backend/translation/translation-settings";
import {
  TRANSCRIPT_SELECTION_LLM_PROMPTS,
  TRANSCRIPT_SELECTION_QUESTION_TEXT,
} from "../src/backend/lecture/questions/transcript-selection-prompts";

function makeSession() {
  const session = createPreparingSession("수업 문맥만 사용", "ko");
  session.status = "listening";
  updateTranslationSettings(session, { enabled: true, targetLanguage: "en" });
  const transcript = TranscriptSchema.parse({
    id: "turn-1",
    itemId: "item-1",
    sequence: 1,
    text: "이진 탐색은 탐색 범위를 절반씩 줄이는 알고리즘입니다.",
    source: "manual",
    receivedAt: new Date().toISOString(),
    startedAtMs: null,
    endedAtMs: null,
    matchedSlidePages: [1],
    matchedSlidePage: 1,
    slideConfidence: 1,
  });
  session.transcripts.push(transcript);
  session.lectureRevision = 1;
  session.translations.push(LiveTranslationSegmentSchema.parse({
    id: "translation-1",
    itemId: transcript.itemId,
    sequence: transcript.sequence,
    sourceText: transcript.text,
    translatedText: "Binary search is an algorithm that repeatedly halves the search range.",
    targetLanguage: "en",
    status: "complete",
    slidePage: 1,
    settingsRevision: session.translationSettings.revision,
    createdAt: Date.now(),
    completedAt: Date.now(),
  }));
  return session;
}

const dependencies: QuestionDependencies = {
  compose: async (context) => {
    assert.equal(context.selection?.kind, "translation");
    assert.equal(context.selection?.intent, "simplify");
    assert.equal(context.selection?.selectedText, "repeatedly halves the search range");
    assert.match(context.selection?.sourceText ?? "", /탐색 범위를 절반/u);
    assert.equal(context.answerLanguage, "en");
    assert.deepEqual(context.transcriptContext.map((turn) => turn.itemId), ["item-1"]);
    return LectureAnswerDraftSchema.parse({
      answerable: true,
      shortAnswer: "The search interval becomes half as large at each step.",
      explanation: "The algorithm compares the middle value and discards the half that cannot contain the target.",
      keyPoints: ["It requires sorted data."],
      evidenceRefs: [{
        type: "transcript",
        sourcePage: null,
        sourceItemIds: ["item-1"],
        noteId: null,
        reason: "selected source transcript",
      }],
      missingContext: [],
    });
  },
  review: async () => LectureAnswerReviewSchema.parse({
    publishable: true,
    unsupportedEvidenceIndexes: [],
    revisionInstructions: [],
    reason: "grounded",
  }),
};

async function main() {
  const session = makeSession();
  const result = createLectureQuestion(session, {
    selection: {
      selectedText: "repeatedly halves the search range",
      sourceItemIds: ["item-1"],
      startSequence: 1,
      endSequence: 1,
      kind: "translation",
      targetLanguage: "en",
      translationIds: ["translation-1"],
      intent: "simplify",
    },
  }, dependencies);
  await session.questionChain;

  assert.equal(result.question.status, "answered");
  assert.equal(result.question.answerLanguage, "en");
  assert.equal(
    result.question.question,
    TRANSCRIPT_SELECTION_QUESTION_TEXT.simplify.en,
  );
  assert.equal(result.question.selection?.intent, "simplify");
  assert.equal(result.question.selection?.kind, "translation");
  assert.equal(result.question.answer?.evidence[0]?.sourceItemIds[0], "item-1");

  assert.throws(
    () => createLectureQuestion(session, {
      selection: {
        selectedText: "fabricated caption",
        sourceItemIds: ["item-1"],
        startSequence: 1,
        endSequence: 1,
        kind: "translation",
        targetLanguage: "en",
        translationIds: ["translation-1"],
      },
    }, dependencies),
    InvalidQuestionTranscriptSelectionError,
  );

  assert.deepEqual(
    Object.keys(TRANSCRIPT_SELECTION_LLM_PROMPTS),
    ["explain", "simplify", "example", "define_terms"],
  );
  for (const prompt of Object.values(TRANSCRIPT_SELECTION_LLM_PROMPTS)) {
    assert.ok(prompt.length > 40, "각 드래그 메뉴 의도에는 구체적인 LLM 프롬프트가 필요함");
  }

  console.log("translated selection regression tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
