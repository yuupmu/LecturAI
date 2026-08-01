import assert from "node:assert/strict";
import {
  endAbsence,
  startAbsence,
  type AbsenceDependencies,
} from "../src/backend/lecture/absence/absence-pipeline";
import {
  cancelEndingCandidate,
  clearActivityTimer,
  processLectureActivity,
} from "../src/backend/lecture/activity/lecture-activity-controller";
import { finalizeLectureSession } from "../src/backend/lecture/notes/finalize-lecture-session";
import {
  createLectureQuestion,
  type QuestionDependencies,
} from "../src/backend/lecture/questions/question-pipeline";
import { queueProfessorStyleUpdate } from "../src/backend/lecture/style/professor-style-profile";
import {
  AbsenceSummaryDraftSchema,
  AbsenceSummaryReviewSchema,
  LectureAnswerDraftSchema,
  LectureAnswerReviewSchema,
  NoteCompositionSchema,
  NoteReviewSchema,
  ProfessorStyleDraftSchema,
  ReviewSchema,
  TranscriptSchema,
  type LectureAnswerDraft,
  type LectureSession,
  type Transcript,
} from "../src/backend/schemas";
import { createPreparingSession } from "../src/backend/session-store";
import { processTranscript } from "../src/backend/transcript/process-transcript";

function addTurn(
  session: LectureSession,
  sequence: number,
  text: string,
  itemId = `item-${sequence}`,
): Transcript {
  const turn = TranscriptSchema.parse({
    id: `turn-${sequence}-${itemId}`,
    itemId,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date().toISOString(),
    startedAtMs: sequence * 1_000,
    endedAtMs: sequence * 1_000 + 900,
    matchedSlidePages: [],
    matchedSlidePage: null,
    slideConfidence: 0,
  });
  session.transcripts.push(turn);
  session.processedItemIds.add(itemId);
  session.lectureRevision += 1;
  if (session.status === "ready") session.status = "listening";
  return turn;
}

function questionDraft(overrides: Partial<LectureAnswerDraft> = {}): LectureAnswerDraft {
  return LectureAnswerDraftSchema.parse({
    answerable: true,
    shortAnswer: "탐색 범위가 매 단계 절반으로 줄기 때문입니다.",
    explanation: "범위가 n, n/2, n/4로 감소하고 반복 횟수가 log₂n에 해당하므로 최악 시간복잡도는 O(log n)입니다.",
    keyPoints: ["매 단계 범위가 절반으로 감소", "반복 횟수는 log₂n"],
    evidenceRefs: [{
      type: "transcript",
      sourcePage: null,
      sourceItemIds: ["item-2", "item-3"],
      noteId: null,
      reason: "시간복잡도 설명",
    }],
    missingContext: [],
    ...overrides,
  });
}

const publishableReview = LectureAnswerReviewSchema.parse({
  publishable: true,
  unsupportedEvidenceIndexes: [],
  revisionInstructions: [],
  reason: "grounded",
});

async function testQuestionGroundingAndSnapshot(): Promise<void> {
  const session = createPreparingSession("현재 수업 내용만 사용", "ko");
  session.status = "listening";
  addTurn(session, 1, "이진 탐색은 정렬된 데이터에서 사용합니다.");
  addTurn(session, 2, "매 단계에서 탐색 범위가 절반으로 감소합니다.");
  addTurn(session, 3, "따라서 반복 횟수는 log₂n이고 최악 시간복잡도는 O(log n)입니다.");

  let releaseComposer: (() => void) | undefined;
  const composerStarted = new Promise<void>((resolve) => {
    releaseComposer = resolve;
  });
  let continueComposer: (() => void) | undefined;
  const composerGate = new Promise<void>((resolve) => {
    continueComposer = resolve;
  });
  const deps: QuestionDependencies = {
    compose: async () => {
      releaseComposer?.();
      await composerGate;
      return questionDraft();
    },
    review: async () => publishableReview,
  };
  const result = createLectureQuestion(
    session,
    "왜 최악 시간복잡도가 O(log n)인가요?",
    deps,
  );
  await composerStarted;
  await processTranscript(session, {
    itemId: "item-4",
    sequence: 4,
    text: "이 발화는 질문 이후에 들어온 추가 설명입니다.",
    source: "manual",
    receivedAt: new Date().toISOString(),
  });
  assert.equal(session.transcripts.length, 4, "질문 생성 중에도 transcript 저장이 진행되어야 함");
  continueComposer?.();
  await session.questionChain;
  assert.equal(result.question.status, "answered");
  assert.equal(result.question.askedAtSequence, 3);
  assert.ok(result.question.answer?.evidence.length);
  assert.ok(result.question.answer?.evidence.every((evidence) =>
    !evidence.sourceItemIds.includes("item-4")
  ), "질문 이후 transcript가 기존 답변 근거에 섞이면 안 됨");
  clearActivityTimer(session);

  session.materialKnowledge = {
    title: "Binary Search",
    summary: "",
    terminology: [],
    outline: [{
      id: "topic-1",
      title: "조건",
      summary: "정렬 조건",
      definitions: [],
      conditions: [{ id: "material-sorted", text: "입력 데이터는 정렬되어 있어야 한다.", sourcePage: 1, sourceText: "정렬" }],
      processes: [],
      formulas: [],
      comparisons: [],
      examples: [],
      warnings: [],
      sourcePages: [1],
    }],
  };
  const materialDeps: QuestionDependencies = {
    compose: async () => questionDraft({
      shortAnswer: "입력 데이터가 정렬되어 있어야 합니다.",
      explanation: "자료 1쪽에 이진 탐색의 조건으로 정렬된 입력이 제시되어 있습니다.",
      evidenceRefs: [{
        type: "material",
        sourcePage: 1,
        sourceItemIds: ["material-sorted"],
        noteId: null,
        reason: "자료 조건",
      }],
    }),
    review: async () => publishableReview,
  };
  const materialQuestion = createLectureQuestion(session, "이진 탐색의 입력 조건은 무엇인가요?", materialDeps);
  await session.questionChain;
  assert.equal(materialQuestion.question.answer?.basedOn, "material_only");
  assert.equal(materialQuestion.question.answer?.evidence[0]?.sourcePage, 1);
}

async function testQuestionInsufficientAndInvalidEvidence(): Promise<void> {
  const session = createPreparingSession("내부 근거만 사용", "ko");
  session.status = "listening";
  addTurn(session, 1, "스택은 후입선출 구조입니다.");
  const insufficient = createLectureQuestion(session, "양자역학을 설명해 주세요.", {
    compose: async () => questionDraft({
      answerable: false,
      shortAnswer: "",
      explanation: "",
      keyPoints: [],
      evidenceRefs: [],
      missingContext: ["현재 수업에서 다루지 않음"],
    }),
    review: async () => publishableReview,
  });
  await session.questionChain;
  assert.equal(insufficient.question.status, "insufficient_context");
  assert.equal(insufficient.question.answer, null);

  const invalid = createLectureQuestion(session, "스택은 무엇인가요?", {
    compose: async () => questionDraft({
      evidenceRefs: [{
        type: "transcript",
        sourcePage: null,
        sourceItemIds: ["does-not-exist"],
        noteId: null,
        reason: "invalid",
      }],
    }),
    review: async () => publishableReview,
  });
  await session.questionChain;
  assert.equal(invalid.question.status, "insufficient_context", "잘못된 evidence ID는 서버가 거절해야 함");

  const first = createLectureQuestion(session, "스택은 무엇인가요?", {
    compose: async () => questionDraft({
      evidenceRefs: [{ type: "transcript", sourcePage: null, sourceItemIds: ["item-1"], noteId: null, reason: "definition" }],
    }),
    review: async () => publishableReview,
  });
  const second = createLectureQuestion(session, "스택은 무엇인가요?", {
    compose: async () => questionDraft({
      evidenceRefs: [{ type: "transcript", sourcePage: null, sourceItemIds: ["item-1"], noteId: null, reason: "definition" }],
    }),
    review: async () => publishableReview,
  });
  await session.questionChain;
  assert.notEqual(first.question.id, second.question.id);
  assert.equal(first.question.status, "answered");
  assert.equal(second.question.status, "answered");
}

async function testProfessorStyleProfile(): Promise<void> {
  const tooShort = createPreparingSession("style", "ko");
  for (let index = 1; index <= 5; index += 1) {
    addTurn(tooShort, index, `먼저 ${index}단계의 핵심 원리를 차근차근 설명하겠습니다.`);
  }
  assert.equal(queueProfessorStyleUpdate(tooShort, async () => {
    throw new Error("should not run");
  }), false);
  assert.equal(tooShort.professorStyleProfile, null);

  const session = createPreparingSession("style", "ko");
  for (let index = 1; index <= 12; index += 1) {
    addTurn(session, index, `먼저 ${index}단계를 보고, 예를 들어 작은 배열로 차근차근 확인해 봅시다.`);
  }
  const queued = queueProfessorStyleUpdate(session, async () => ProfessorStyleDraftSchema.parse({
    formality: "mixed",
    explanationDensity: "detailed",
    sentenceLength: "mixed",
    usesStepByStepExplanation: true,
    usesAnalogies: true,
    usesExamplesFrequently: true,
    usesQuestionsRhetorically: false,
    recurringPhrases: ["먼저 살펴봅시다", "멍청한 질문"],
    emphasisPatterns: ["핵심입니다"],
    transitionPatterns: ["다음 단계로 갑시다"],
    styleSummary: "단계별 예시를 선호하는 설명 방식",
  }));
  assert.equal(queued, true);
  await session.professorStyleChain;
  assert.equal(session.professorStyleProfile?.revision, 1);
  assert.equal(session.professorStyleProfile?.usesStepByStepExplanation, true);
  assert.ok(!session.professorStyleProfile?.recurringPhrases.some((phrase) => /멍청/u.test(phrase)));
}

const absenceDraft = AbsenceSummaryDraftSchema.parse({
  overview: "부재 중 이진 탐색의 활용 조건을 설명했습니다.",
  detailedSections: [{
    title: "활용 조건",
    explanation: "정렬된 데이터에서 반복 탐색할 때 활용합니다.",
    keyPoints: ["입력 데이터가 정렬되어 있어야 합니다."],
  }],
  importantPoints: ["정렬 조건"],
  currentLecturePosition: "이진 탐색 활용 상황",
  suggestedReviewQuestions: ["어떤 데이터에서 이진 탐색을 사용할 수 있나요?"],
  sourceItemIds: ["away-1"],
  sourceNoteIds: [],
  sourcePages: [],
});

const absenceDeps: AbsenceDependencies = {
  compose: async () => absenceDraft,
  review: async () => AbsenceSummaryReviewSchema.parse({
    publishable: true,
    revisionInstructions: [],
    reason: "grounded",
  }),
};

async function testAbsenceLifecycleAndFallback(): Promise<void> {
  const session = createPreparingSession("absence", "ko");
  session.status = "listening";
  addTurn(session, 1, "부재 시작 전 이진 탐색을 설명합니다.", "before-1");
  const started = startAbsence(session);
  assert.equal(started.span.startedAtSequence, 1);
  assert.equal(startAbsence(session).accepted, false, "active span 중복 생성 금지");
  addTurn(session, 2, "정렬된 데이터에서 반복 탐색할 때 이진 탐색을 활용합니다.", "away-1");
  const ended = endAbsence(session, absenceDeps);
  assert.equal(ended.span.endedAtSequence, 2);
  addTurn(session, 3, "복귀 이후 새로 설명한 내용입니다.", "after-1");
  await session.absenceSummaryChain;
  assert.equal(ended.span.status, "completed");
  assert.deepEqual(ended.span.summary?.sourceItemIds, ["away-1"]);
  assert.ok(!ended.span.summary?.sourceItemIds.includes("after-1"));

  assert.throws(() => endAbsence(session, absenceDeps), /NO_ACTIVE_ABSENCE/);
  const second = startAbsence(session);
  addTurn(session, 4, "부재 중 두 번째 설명입니다.", "away-2");
  endAbsence(session, {
    compose: async () => { throw new Error("mock model failure"); },
    review: async () => { throw new Error("review should not run"); },
  });
  await session.absenceSummaryChain;
  assert.equal(second.span.status, "completed", "요약 실패가 summarizing에 고정되면 안 됨");
  assert.equal(second.span.summary?.fallback, true);
  assert.equal(session.absenceSpans.length, 2);
}

async function testExplicitEndingAndCancellation(): Promise<void> {
  const session = createPreparingSession("ending", "ko");
  session.status = "listening";
  const first = addTurn(session, 1, "오늘 수업은");
  processLectureActivity(session, first, { explicitGraceSeconds: 100 });
  assert.equal(session.activityState.endingCandidate, null);
  const second = addTurn(session, 2, "여기까지 하겠습니다.");
  processLectureActivity(session, second, { explicitGraceSeconds: 100 });
  assert.equal(session.status, "ending_candidate");
  assert.equal(candidateKind(session), "explicit");
  const instruction = addTurn(session, 3, "그 전에 이진 탐색의 활용 예시를 한 가지 더 보겠습니다.");
  processLectureActivity(session, instruction, { explicitGraceSeconds: 100 });
  assert.equal(session.activityState.endingCandidate, null, "새 instructional content가 종료 후보를 취소해야 함");
  assert.equal(session.status, "listening");

  const endingAgain = addTurn(session, 4, "이상으로 강의를 마치겠습니다.");
  processLectureActivity(session, endingAgain, { explicitGraceSeconds: 100 });
  assert.equal(cancelEndingCandidate(session).accepted, true);
  assert.equal(session.status, "listening");
  assert.equal(cancelEndingCandidate(session).accepted, false, "중복 취소는 상태를 손상시키면 안 됨");
  clearActivityTimer(session);

  for (const [index, text] of [
    "‘수업을 마치겠습니다’라고 말하면 종료됩니다.",
    "수업을 마치기 전에 문제를 하나 더 보겠습니다.",
    "잠시 쉬었다가 수업을 이어가겠습니다.",
  ].entries()) {
    const guarded = createPreparingSession("guard", "ko");
    guarded.status = "listening";
    const turn = addTurn(guarded, index + 1, text);
    processLectureActivity(guarded, turn, { explicitGraceSeconds: 100 });
    assert.equal(guarded.activityState.endingCandidate, null, `종료 오탐 금지: ${text}`);
    clearActivityTimer(guarded);
  }
}

async function testInactivityAndAbsenceSuppression(): Promise<void> {
  const session = createPreparingSession("inactivity", "ko");
  session.status = "listening";
  const instruction = addTurn(session, 1, "이진 탐색은 탐색 범위를 절반씩 줄이는 알고리즘입니다.");
  processLectureActivity(session, instruction, {
    inactivitySeconds: 0.01,
    inactivityGraceSeconds: 100,
  });
  await delay(30);
  assert.equal(session.status, "inactivity_candidate");
  assert.equal(session.activityState.endingCandidate?.kind, "inactivity");
  assert.equal(cancelEndingCandidate(session).accepted, true);
  clearActivityTimer(session);

  const chatterOnly = createPreparingSession("chatter", "ko");
  chatterOnly.status = "listening";
  const chatter = addTurn(chatterOnly, 1, "오늘 점심 메뉴와 주말 날씨 이야기를 조금 해보겠습니다.");
  processLectureActivity(chatterOnly, chatter, {
    inactivitySeconds: 0.01,
    inactivityGraceSeconds: 100,
  });
  await delay(30);
  assert.equal(candidateKind(chatterOnly), "inactivity", "잡담은 비활동 타이머를 초기화하면 안 됨");
  clearActivityTimer(chatterOnly);

  const absent = createPreparingSession("absence suppression", "ko");
  absent.status = "listening";
  startAbsence(absent);
  const talk = addTurn(absent, 1, "마이크 소리가 잘 들리나요?");
  processLectureActivity(absent, talk, {
    inactivitySeconds: 0.01,
    inactivityGraceSeconds: 100,
  });
  await delay(30);
  assert.equal(absent.activityState.endingCandidate, null, "active absence 중 inactivity 후보 금지");
  const explicit = addTurn(absent, 2, "오늘 수업은 여기까지 하겠습니다.");
  processLectureActivity(absent, explicit, { explicitGraceSeconds: 100 });
  assert.equal(candidateKind(absent), "explicit", "부재 중 명시적 종료는 감지해야 함");
  clearActivityTimer(absent);
}

async function testGraceFinalizationCallback(): Promise<void> {
  const session = createPreparingSession("grace", "ko");
  session.status = "listening";
  let finalized = 0;
  const ending = addTurn(session, 1, "오늘 수업은 여기까지 하겠습니다.");
  processLectureActivity(session, ending, {
    explicitGraceSeconds: 0.01,
    finalize: async (target) => {
      finalized += 1;
      target.status = "ended";
    },
  });
  await delay(30);
  assert.equal(finalized, 1);
  assert.equal(session.status, "ended");
  clearActivityTimer(session);
}

async function testBinarySearchIntegratedScenario(): Promise<void> {
  const session = createPreparingSession("binary integration", "ko");
  session.status = "listening";
  addTurn(session, 1, "이진 탐색은 정렬된 데이터에서 사용합니다.");
  addTurn(session, 2, "매 단계마다 탐색 범위가 n, n/2, n/4 형태로 절반씩 감소합니다.");
  addTurn(session, 3, "반복 횟수는 log₂n이고 따라서 최악 시간복잡도는 O(log n)입니다.");
  const question = createLectureQuestion(session, "왜 O(log n)인가요?", {
    compose: async () => questionDraft(),
    review: async () => publishableReview,
  });
  await session.questionChain;
  assert.match(question.question.answer?.text ?? "", /n\/2.*n\/4/u);
  assert.match(question.question.answer?.text ?? "", /O\(log n\)/u);

  startAbsence(session);
  addTurn(session, 4, "이진 탐색은 사전이나 정렬된 목록에서 값을 반복해서 찾을 때 활용할 수 있습니다.", "away-1");
  const absence = endAbsence(session, absenceDeps).span;
  await session.absenceSummaryChain;
  assert.equal(absence.summary?.sourceItemIds.includes("away-1"), true);

  const ending = addTurn(session, 5, "오늘 수업은 여기까지 하겠습니다.");
  processLectureActivity(session, ending, { explicitGraceSeconds: 100 });
  assert.equal(session.status, "ending_candidate");
  clearActivityTimer(session);
}

async function testFinalizationSettlesActiveAbsence(): Promise<void> {
  const session = createPreparingSession("final", "ko");
  session.status = "listening";
  startAbsence(session);
  addTurn(session, 1, "부재 중에도 마지막 설명을 보존합니다.", "away-1");
  const pendingQuestion = createLectureQuestion(session, "마지막 설명은 무엇인가요?", {
    compose: async () => new Promise<LectureAnswerDraft>(() => undefined),
    review: async () => publishableReview,
  }).question;
  const noteDependencies = {
    compose: async () => NoteCompositionSchema.parse({
      baseRevision: 0,
      title: "최종 필기",
      sections: [{
        heading: "마지막 설명",
        layout: "bullets",
        items: [{ text: "부재 중에도 마지막 설명을 보존한다.", importance: "normal", sourceItemIds: ["away-1"], sourcePages: [] }],
      }],
    }),
    review: async () => NoteReviewSchema.parse({
      baseRevision: 0,
      publishable: true,
      unsupportedItemIds: [],
      missingKnowledgeUnitIds: [],
      duplicateGroups: [],
      importanceCorrections: [],
      revisionInstructions: [],
    }),
    revise: async () => { throw new Error("revision should not run"); },
  };
  const review = ReviewSchema.parse({
    generatedAt: new Date().toISOString(),
    questions: [1, 2, 3].map((index) => ({
      question: `질문 ${index}`,
      choices: [],
      answer: "답",
      explanation: "설명",
      slidePage: 1,
      basisEventIds: [],
    })),
  });
  const first = finalizeLectureSession(session, {
    noteDependencies,
    absenceDependencies: absenceDeps,
    generateReview: async () => review,
    concurrentTaskTimeoutMs: 10,
  });
  const second = finalizeLectureSession(session, {
    noteDependencies,
    absenceDependencies: absenceDeps,
    generateReview: async () => review,
    concurrentTaskTimeoutMs: 10,
  });
  assert.equal(first, second, "중복 종료는 같은 finalization promise를 반환해야 함");
  await first;
  assert.equal(session.status, "ended");
  assert.equal(session.absenceSpans[0]?.status, "completed");
  assert.equal(session.noteGeneration.finalNote?.status, "final");
  assert.equal(pendingQuestion.status, "failed", "종료 제한 시간을 넘긴 질문은 명확히 실패 처리해야 함");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidateKind(session: LectureSession): "explicit" | "inactivity" | null {
  return session.activityState.endingCandidate?.kind ?? null;
}

async function main(): Promise<void> {
  await testQuestionGroundingAndSnapshot();
  await testQuestionInsufficientAndInvalidEvidence();
  await testProfessorStyleProfile();
  await testAbsenceLifecycleAndFallback();
  await testExplicitEndingAndCancellation();
  await testInactivityAndAbsenceSuppression();
  await testGraceFinalizationCallback();
  await testBinarySearchIntegratedScenario();
  await testFinalizationSettlesActiveAbsence();
  console.log("stage two regression tests passed");
}

void main();
