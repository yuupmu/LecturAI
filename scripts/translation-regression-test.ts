import assert from "node:assert/strict";
import { createPreparingSession } from "../src/backend/session-store";
import { TranscriptSchema, type Transcript } from "../src/backend/schemas";
import { scheduleTranslation } from "../src/backend/translation/translation-scheduler";
import { updateTranslationSettings } from "../src/backend/translation/translation-settings";
import {
  cleanTranslationOutput,
  type TranslateTranscriptInput,
} from "../src/backend/translation/translate-transcript";

function makeSession() {
  const session = createPreparingSession("강의를 해석하세요.", "ko");
  session.slideMap = {
    documentTitle: "Binary Search",
    documentSummary: "",
    language: "ko",
    globalKeywords: [],
    slides: [{
      page: 1,
      title: "Binary Search",
      summary: "",
      keyConcepts: Array.from({ length: 12 }, (_, index) => `concept-${index}`),
      keywords: Array.from({ length: 12 }, (_, index) => `keyword-${index}`),
      factualClaims: [],
    }],
  };
  session.currentSlidePage = 1;
  return session;
}

function makeTranscript(sequence: number, text: string): Transcript {
  return TranscriptSchema.parse({
    id: `transcript-${sequence}`,
    itemId: `item-${sequence}`,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date().toISOString(),
    startedAtMs: null,
    endedAtMs: null,
    matchedSlidePages: [1],
    matchedSlidePage: 1,
    slideConfidence: 1,
  });
}

async function testOffMeansNoWork() {
  const session = makeSession();
  let calls = 0;
  scheduleTranslation(session, makeTranscript(1, "번역하지 마세요."), {
    translate: async () => {
      calls += 1;
      return { translatedText: "Do not translate." };
    },
  });
  await session.translationChain;
  assert.equal(calls, 0);
  assert.equal(session.translations.length, 0);
  assert.equal(
    session.rawLogs.some((log) => log.name.startsWith("translation_")),
    false,
  );
}

async function testDirectTranslationContextOrderingAndDeduplication() {
  const session = makeSession();
  updateTranslationSettings(session, { enabled: true, targetLanguage: "en" });
  const calls: Array<{
    text: string;
    concepts: number;
    keywords: number;
    recentContext: string[];
  }> = [];
  const translate = async (input: TranslateTranscriptInput) => {
    calls.push({
      text: input.text,
      concepts: input.currentSlide?.keyConcepts.length ?? 0,
      keywords: input.currentSlide?.keywords.length ?? 0,
      recentContext: input.recentContext.map((item) => item.text),
    });
    return { translatedText: `EN:${input.text}` };
  };
  const first = makeTranscript(1, "첫 문장");
  const second = makeTranscript(2, "둘째 문장 O(log n)");
  session.transcripts.push(first, second);
  scheduleTranslation(session, first, { translate });
  scheduleTranslation(session, second, { translate });
  scheduleTranslation(session, second, { translate });
  await session.translationChain;

  assert.deepEqual(calls.map((call) => call.text), [first.text, second.text]);
  assert.deepEqual(calls.map((call) => [call.concepts, call.keywords]), [[8, 8], [8, 8]]);
  assert.deepEqual(calls[1].recentContext, [first.text]);
  assert.deepEqual(
    session.translations.map((segment) => [segment.sequence, segment.status]),
    [[1, "complete"], [2, "complete"]],
  );
  assert.match(session.translations[1].translatedText ?? "", /O\(log n\)/u);
  assert.equal(
    session.rawLogs.filter((log) => log.name === "translation_ai_request").length,
    2,
  );
  assert.equal(
    session.rawLogs.some((log) => log.name.includes("machine") || log.name.includes("refinement")),
    false,
  );
}

async function testTranslationPublishesOnceComplete() {
  const session = makeSession();
  updateTranslationSettings(session, { enabled: true, targetLanguage: "en" });
  let release!: (value: { translatedText: string }) => void;
  const pendingTranslation = new Promise<{ translatedText: string }>((resolve) => {
    release = resolve;
  });
  const transcript = makeTranscript(1, "바로 번역");
  session.transcripts.push(transcript);
  scheduleTranslation(session, transcript, {
    translate: async () => pendingTranslation,
  });

  assert.equal(session.translations[0].status, "translating");
  assert.equal(session.translations[0].translatedText, null);
  release({ translatedText: "Direct AI output" });
  await session.translationChain;
  assert.equal(session.translations[0].status, "complete");
  assert.equal(session.translations[0].translatedText, "Direct AI output");
}

async function testStaleResultIsDiscarded() {
  const session = makeSession();
  updateTranslationSettings(session, { enabled: true, targetLanguage: "en" });
  let release!: (value: { translatedText: string }) => void;
  const pending = new Promise<{ translatedText: string }>((resolve) => {
    release = resolve;
  });
  const transcript = makeTranscript(1, "느린 문장");
  session.transcripts.push(transcript);
  scheduleTranslation(session, transcript, { translate: () => pending });
  const staleChain = session.translationChain;
  await Promise.resolve();
  updateTranslationSettings(session, { enabled: false, targetLanguage: null });
  release({ translatedText: "A late sentence" });
  await staleChain;

  assert.equal(session.translations.length, 0);
  assert.equal(
    session.rawLogs.some((log) => log.name === "translation_discarded"),
    true,
  );
}

async function testFailureDoesNotStopNextCaption() {
  const session = makeSession();
  updateTranslationSettings(session, { enabled: true, targetLanguage: "ko" });
  let calls = 0;
  const translate = async () => {
    calls += 1;
    if (calls === 1) throw new Error("synthetic failure");
    return { translatedText: "두 번째 번역" };
  };
  const first = makeTranscript(1, "First");
  const second = makeTranscript(2, "Second");
  session.transcripts.push(first, second);
  scheduleTranslation(session, first, { translate });
  scheduleTranslation(session, second, { translate });
  await session.translationChain;

  assert.equal(session.translations[0].status, "failed");
  assert.equal(session.translations[1].status, "complete");
  assert.equal(session.translations[1].translatedText, "두 번째 번역");
}

async function main() {
  await testOffMeansNoWork();
  await testDirectTranslationContextOrderingAndDeduplication();
  await testTranslationPublishesOnceComplete();
  await testStaleResultIsDiscarded();
  await testFailureDoesNotStopNextCaption();
  assert.equal(cleanTranslationOutput("```text\nO(log n), not O(n).\n```"), "O(log n), not O(n).");
  console.log("translation regression tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
