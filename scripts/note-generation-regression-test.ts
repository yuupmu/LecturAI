import assert from "node:assert/strict";
import {
  requestNoteGeneration,
  runDueAutomaticNoteCheckpoint,
  scheduleNextAutomaticNote,
  setAutomaticNoteGeneration,
  type NoteGenerationDependencies,
} from "../src/backend/lecture/notes/cumulative-note-pipeline";
import { finalizeLectureSession } from "../src/backend/lecture/notes/finalize-lecture-session";
import {
  NoteCompositionSchema,
  NoteReviewSchema,
  TranscriptSchema,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type Review,
  type Transcript,
} from "../src/backend/schemas";
import {
  createPreparingSession,
  resetSession,
} from "../src/backend/session-store";
import { processTranscript } from "../src/backend/transcript/process-transcript";

function makeSession(): LectureSession {
  const session = createPreparingSession("누적 구조화 필기", "ko");
  session.status = "listening";
  assert.equal(session.noteGeneration.intervalSeconds, 120);
  return session;
}

function addTranscript(
  session: LectureSession,
  sequence: number,
  text: string,
): Transcript {
  const transcript = TranscriptSchema.parse({
    id: `turn-${sequence}`,
    itemId: `item-${sequence}`,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date(1_700_000_000_000 + sequence * 1_000).toISOString(),
    startedAtMs: sequence * 1_000,
    endedAtMs: sequence * 1_000 + 900,
    matchedSlidePages: [],
    matchedSlidePage: null,
    slideConfidence: 0,
  });
  session.transcripts.push(transcript);
  session.transcripts.sort((left, right) => left.sequence - right.sequence);
  session.processedItemIds.add(transcript.itemId);
  return transcript;
}

function findSource(
  allTurns: Transcript[],
  pattern: RegExp,
): string[] {
  return allTurns.filter((turn) => pattern.test(turn.text)).map((turn) => turn.itemId);
}

function fakeComposition(
  session: LectureSession,
  existingNote: LectureNote | null,
  newTurns: Transcript[],
  baseRevision: number,
): NoteComposition {
  const previousTurns = session.transcripts.filter((turn) =>
    existingNote?.sourceItemIds.includes(turn.itemId)
  );
  const allTurns = [...previousTurns, ...newTurns];
  const sections: NoteComposition["sections"] = [];
  const conditionSources = findSource(allTurns, /정렬/);
  if (conditionSources.length > 0) {
    sections.push({
      heading: "조건",
      layout: "bullets",
      items: [{
        text: "입력 데이터가 정렬되어 있어야 한다.",
        importance: "normal",
        sourceItemIds: conditionSources,
        sourcePages: [],
      }],
    });
  }
  const steps = [
    [/가운데|중간값/, "탐색 구간의 중간값을 확인한다."],
    [/목표값.*비교/, "목표값과 중간값을 비교한다."],
    [/필요 없는 절반/, "비교 결과에 따라 필요 없는 절반을 제거한다."],
  ] as const;
  const processItems = steps.flatMap(([pattern, text]) => {
    const sources = findSource(allTurns, pattern);
    return sources.length > 0
      ? [{ text, importance: "normal" as const, sourceItemIds: sources, sourcePages: [] }]
      : [];
  });
  if (processItems.length > 0) {
    sections.push({ heading: "과정", layout: "steps", items: processItems });
  }
  const reductionSources = findSource(allTurns, /범위가 절반.*감소/);
  const complexitySources = findSource(allTurns, /O\s*\(log\s*n\)/i);
  const examSources = findSource(allTurns, /시험에.*(?:내|나)/);
  const complexityItems: NoteComposition["sections"][number]["items"] = [];
  if (reductionSources.length > 0) {
    complexityItems.push({
      text: "매 단계에서 탐색 범위가 절반으로 감소한다.",
      importance: "normal",
      sourceItemIds: reductionSources,
      sourcePages: [],
    });
  }
  if (complexitySources.length > 0) {
    complexityItems.push({
      text: "최악 시간복잡도는 O(log n)이다.",
      importance: examSources.length > 0 ? "exam" : "normal",
      sourceItemIds: [...complexitySources, ...examSources],
      sourcePages: [],
    });
  }
  if (complexityItems.length > 0) {
    sections.push({
      heading: "시간복잡도",
      layout: "bullets",
      items: complexityItems,
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: "수업 내용",
      layout: "bullets",
      items: newTurns.map((turn) => ({
        text: turn.text,
        importance: "normal",
        sourceItemIds: [turn.itemId],
        sourcePages: [],
      })),
    });
  }
  return NoteCompositionSchema.parse({
    baseRevision,
    title: "Binary Search",
    sections,
  });
}

function mockDependencies(
  hooks: Partial<NoteGenerationDependencies> = {},
): NoteGenerationDependencies {
  return {
    compose: hooks.compose ?? (async (session, context, baseRevision) =>
      fakeComposition(
        session,
        context.existingNote,
        context.newTurnsToProcess,
        baseRevision,
      )),
    review: hooks.review ?? (async (_session, _context, _note, baseRevision) =>
      NoteReviewSchema.parse({
        baseRevision,
        publishable: true,
        unsupportedItemIds: [],
        missingKnowledgeUnitIds: [],
        duplicateGroups: [],
        importanceCorrections: [],
        revisionInstructions: [],
      })),
    revise: hooks.revise ?? (async (session, context, _note, _review, baseRevision) =>
      fakeComposition(
        session,
        context.existingNote,
        context.newTurnsToProcess,
        baseRevision,
      )),
  };
}

async function waitForNotes(session: LectureSession): Promise<void> {
  await session.noteGenerationChain;
}

function noteTexts(note: LectureNote | null): string[] {
  return note?.sections.flatMap((section) => section.items.map((item) => item.text)) ?? [];
}

function cleanup(session: LectureSession): void {
  if (session.noteGenerationTimer) clearTimeout(session.noteGenerationTimer);
  session.noteGenerationTimer = null;
}

async function testBinarySearchCheckpoints(): Promise<void> {
  const session = makeSession();
  const deps = mockDependencies();
  addTranscript(session, 1, "이진 탐색은 정렬된 데이터에서 사용할 수 있습니다.");
  addTranscript(session, 2, "먼저 탐색 구간의 가운데 값을 확인합니다.");
  addTranscript(session, 3, "목표값과 가운데 값을 비교합니다.");
  assert.equal(requestNoteGeneration(session, "scheduled", deps).accepted, true);
  await waitForNotes(session);
  const first = session.noteGeneration.currentNote;
  assert.ok(first);
  assert.deepEqual(noteTexts(first), [
    "입력 데이터가 정렬되어 있어야 한다.",
    "탐색 구간의 중간값을 확인한다.",
    "목표값과 중간값을 비교한다.",
  ]);
  const stableConditionId = first.sections[0].items[0].id;

  addTranscript(session, 4, "비교 결과에 따라 필요 없는 절반을 제거합니다.");
  addTranscript(session, 5, "찾을 때까지 이 과정을 반복합니다.");
  assert.equal(requestNoteGeneration(session, "manual", deps).accepted, true);
  await waitForNotes(session);
  const second = session.noteGeneration.currentNote;
  assert.ok(second);
  assert.ok(session.noteGeneration.lastGeneratedAt);
  assert.ok(session.noteGeneration.nextScheduledAt);
  const nextDelay = new Date(session.noteGeneration.nextScheduledAt).getTime() - Date.now();
  assert.ok(nextDelay > 115_000 && nextDelay <= 120_000);
  assert.equal(second.sections[0].items[0].id, stableConditionId, "stable item id");
  assert.match(noteTexts(second).join(" "), /필요 없는 절반/);
  assert.equal(new Set(noteTexts(second)).size, noteTexts(second).length);

  addTranscript(session, 6, "매 단계마다 탐색 범위가 절반으로 감소합니다.");
  addTranscript(session, 7, "따라서 최악 시간복잡도는 O(log n)입니다.");
  addTranscript(session, 8, "이 부분은 시험에 내겠습니다.");
  assert.equal(requestNoteGeneration(session, "scheduled", deps).accepted, true);
  await waitForNotes(session);
  const third = session.noteGeneration.currentNote;
  assert.ok(third);
  assert.equal(third.processedThroughSequence, 8);
  const complexity = third.sections.flatMap((section) => section.items)
    .find((item) => /O\s*\(log\s*n\)/i.test(item.text));
  assert.equal(complexity?.importance, "exam");
  assert.equal(session.noteGeneration.lastProcessedSequence, 8);
  cleanup(session);
}

async function testSnapshotAndNoNewContent(): Promise<void> {
  const session = makeSession();
  addTranscript(session, 1, "이진 탐색은 정렬된 데이터에서 사용할 수 있습니다.");
  let release!: () => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = mockDependencies({
    compose: async (current, context, baseRevision) => {
      started();
      await gate;
      return fakeComposition(current, context.existingNote, context.newTurnsToProcess, baseRevision);
    },
  });
  requestNoteGeneration(session, "manual", deps);
  await didStart;
  addTranscript(session, 2, "먼저 탐색 구간의 가운데 값을 확인합니다.");
  release();
  await waitForNotes(session);
  assert.equal(session.noteGeneration.lastProcessedSequence, 1);
  assert.equal(session.noteGeneration.currentNote?.processedThroughSequence, 1);
  assert.ok(session.transcripts.some((turn) =>
    turn.sequence > session.noteGeneration.lastProcessedSequence
  ));
  const noNewSession = makeSession();
  addTranscript(noNewSession, 1, "정렬된 데이터가 조건입니다.");
  const noNewDeps = mockDependencies();
  requestNoteGeneration(noNewSession, "manual", noNewDeps);
  await waitForNotes(noNewSession);
  const result = requestNoteGeneration(noNewSession, "manual", noNewDeps);
  assert.equal(result.accepted, false);
  assert.match(result.message, /새로 정리/);
  cleanup(session);
  cleanup(noNewSession);
}

async function testPendingManualAndFailureCursor(): Promise<void> {
  const session = makeSession();
  addTranscript(session, 1, "정렬된 데이터에서 사용합니다.");
  addTranscript(session, 2, "가운데 값을 확인합니다.");
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = mockDependencies({
    compose: async (current, context, baseRevision) => {
      calls += 1;
      if (calls === 1) {
        started();
        await gate;
      }
      return fakeComposition(current, context.existingNote, context.newTurnsToProcess, baseRevision);
    },
  });
  requestNoteGeneration(session, "scheduled", deps);
  await didStart;
  addTranscript(session, 3, "목표값과 가운데 값을 비교합니다.");
  assert.equal(requestNoteGeneration(session, "manual", deps).queued, true);
  assert.equal(requestNoteGeneration(session, "manual", deps).queued, true);
  release();
  await waitForNotes(session);
  assert.equal(calls, 2, "multiple clicks collapse into one pending manual job");
  assert.equal(session.noteGeneration.lastProcessedSequence, 3);

  const failed = makeSession();
  addTranscript(failed, 1, "정렬된 데이터가 조건입니다.");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    requestNoteGeneration(failed, "manual", mockDependencies({
      compose: async () => { throw new Error("MOCK_COMPOSER_FAILURE"); },
    }));
    await waitForNotes(failed);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failed.noteGeneration.status, "failed");
  assert.equal(failed.noteGeneration.lastProcessedSequence, 0);
  assert.match(failed.noteGeneration.lastError ?? "", /MOCK_COMPOSER_FAILURE/);
  cleanup(session);
  cleanup(failed);
}

async function testNegativeEmphasisIsNotPromoted(): Promise<void> {
  const session = makeSession();
  addTranscript(
    session,
    1,
    "최악 시간복잡도는 O(log n)이지만 이 내용은 시험에 나오지 않습니다.",
  );
  requestNoteGeneration(session, "manual", mockDependencies());
  await waitForNotes(session);
  const item = session.noteGeneration.currentNote?.sections
    .flatMap((section) => section.items)
    .find((candidate) => /O\s*\(log\s*n\)/i.test(candidate.text));
  assert.equal(item?.importance, "normal");
  cleanup(session);
}

async function testToggleAndResetStaleResult(): Promise<void> {
  const session = makeSession();
  assert.equal(setAutomaticNoteGeneration(session, false).accepted, true);
  assert.equal(session.noteGeneration.nextScheduledAt, null);
  assert.equal(setAutomaticNoteGeneration(session, true).accepted, true);
  assert.ok(session.noteGeneration.nextScheduledAt);

  addTranscript(session, 1, "정렬된 데이터가 조건입니다.");
  let release!: () => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = mockDependencies({
    compose: async (current, context, baseRevision) => {
      started();
      await gate;
      return fakeComposition(current, context.existingNote, context.newTurnsToProcess, baseRevision);
    },
  });
  requestNoteGeneration(session, "manual", deps);
  const oldChain = session.noteGenerationChain;
  await didStart;
  await resetSession(session);
  release();
  await oldChain;
  assert.equal(session.noteGeneration.currentNote, null);
  assert.equal(session.noteGeneration.lastProcessedSequence, 0);
  assert.deepEqual(session.noteGeneration.processedItemIds, []);
  assert.equal(session.noteGeneration.activeJobId, null);
  cleanup(session);
}

async function testServerTimerDispatch(): Promise<void> {
  const session = makeSession();
  session.noteGeneration.intervalSeconds = 0.01;
  addTranscript(session, 1, "정렬된 데이터에서 사용합니다.");
  addTranscript(session, 2, "가운데 값을 확인합니다.");
  scheduleNextAutomaticNote(session, "mock_timer_test", mockDependencies());
  assert.ok(session.noteGeneration.nextScheduledAt);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await waitForNotes(session);
  assert.equal(session.noteGeneration.lastProcessedSequence, 2);
  assert.ok(session.noteGeneration.currentNote);
  cleanup(session);
}

async function testPollingRecoversDroppedTimerWithoutWaitingForModel(): Promise<void> {
  const session = makeSession();
  addTranscript(session, 1, "이진 탐색은 정렬된 데이터에서 사용합니다.");
  addTranscript(session, 2, "목표값과 가운데 값을 비교합니다.");

  let release!: () => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = mockDependencies({
    compose: async (current, context, baseRevision) => {
      started();
      await gate;
      return fakeComposition(
        current,
        context.existingNote,
        context.newTurnsToProcess,
        baseRevision,
      );
    },
  });

  scheduleNextAutomaticNote(session, "mock_dropped_timer", deps);
  assert.ok(session.noteGenerationTimer);
  clearTimeout(session.noteGenerationTimer!);
  session.noteGenerationTimer = null;
  session.noteGeneration.nextScheduledAt = new Date(Date.now() - 1).toISOString();

  const dispatchStartedAt = performance.now();
  assert.equal(runDueAutomaticNoteCheckpoint(session, deps), true);
  const dispatchDurationMs = performance.now() - dispatchStartedAt;
  assert.ok(
    dispatchDurationMs < 50,
    `checkpoint dispatch should not await model work (${dispatchDurationMs}ms)`,
  );
  assert.equal(session.noteGeneration.status, "queued");

  await didStart;
  assert.equal(session.noteGeneration.status, "generating");
  release();
  await waitForNotes(session);
  assert.equal(session.noteGeneration.lastProcessedSequence, 2);
  assert.ok(session.noteGeneration.currentNote);
  assert.ok(session.noteGeneration.nextScheduledAt);
  cleanup(session);
}

async function testScheduledShortTurnIsReviewed(): Promise<void> {
  const session = makeSession();
  addTranscript(session, 1, "핵심 정의입니다.");
  let reviewCalls = 0;
  let reviseCalls = 0;
  const deps = mockDependencies({
    review: async (_current, _context, _note, baseRevision) => {
      reviewCalls += 1;
      return NoteReviewSchema.parse({
        baseRevision,
        publishable: false,
        unsupportedItemIds: [],
        missingKnowledgeUnitIds: ["item-1"],
        duplicateGroups: [],
        importanceCorrections: [],
        revisionInstructions: ["짧은 발화의 핵심 정의를 포함하세요."],
      });
    },
    revise: async (current, context, _note, _review, baseRevision) => {
      reviseCalls += 1;
      return fakeComposition(
        current,
        context.existingNote,
        context.newTurnsToProcess,
        baseRevision,
      );
    },
  });

  assert.equal(requestNoteGeneration(session, "scheduled", deps).accepted, true);
  await waitForNotes(session);
  assert.equal(reviewCalls, 1, "scheduled notes receive a grounding review");
  assert.equal(reviseCalls, 1, "failed scheduled reviews receive one revision");
  assert.deepEqual(session.noteGeneration.processedItemIds, ["item-1"]);
  cleanup(session);
}

async function testLateTranscriptIsNotDropped(): Promise<void> {
  const session = makeSession();
  const deps = mockDependencies();
  addTranscript(session, 10, "이진 탐색은 정렬된 데이터에서 사용합니다.");
  assert.equal(requestNoteGeneration(session, "scheduled", deps).accepted, true);
  await waitForNotes(session);
  assert.equal(session.noteGeneration.lastProcessedSequence, 10);

  addTranscript(session, 9, "목표값과 가운데 값을 비교합니다.");
  assert.equal(requestNoteGeneration(session, "scheduled", deps).accepted, true);
  await waitForNotes(session);
  assert.equal(
    session.noteGeneration.lastProcessedSequence,
    10,
    "display cursor never moves backwards",
  );
  assert.equal(session.noteGeneration.processedItemIds.includes("item-9"), true);
  assert.equal(
    session.noteGeneration.currentNote?.sourceItemIds.includes("item-9"),
    true,
  );
  cleanup(session);
}

function mockReview(): Review {
  return {
    generatedAt: new Date().toISOString(),
    questions: [1, 2, 3].map((index) => ({
      question: `복습 ${index}`,
      choices: [],
      answer: "답",
      explanation: "설명",
      slidePage: 1,
      basisEventIds: [],
    })),
  };
}

async function testFinalNoteAndDuplicateFinalization(): Promise<void> {
  const session = makeSession();
  const deps = mockDependencies();
  addTranscript(session, 1, "이진 탐색은 정렬된 데이터에서 사용할 수 있습니다.");
  addTranscript(session, 2, "먼저 탐색 구간의 가운데 값을 확인합니다.");
  requestNoteGeneration(session, "manual", deps);
  await waitForNotes(session);
  const liveNote = session.noteGeneration.currentNote;
  assert.ok(liveNote);
  addTranscript(session, 3, "목표값과 가운데 값을 비교합니다.");
  addTranscript(session, 4, "비교 결과에 따라 필요 없는 절반을 제거합니다.");
  addTranscript(session, 5, "매 단계마다 탐색 범위가 절반으로 감소합니다.");
  addTranscript(session, 6, "최악 시간복잡도는 O(log n)입니다. 시험에 나옵니다.");
  let finalComposeCalls = 0;
  const finalDeps = mockDependencies({
    compose: async (current, context, baseRevision) => {
      if (context.trigger === "final") finalComposeCalls += 1;
      return fakeComposition(current, context.existingNote, context.newTurnsToProcess, baseRevision);
    },
  });
  const first = finalizeLectureSession(session, {
    noteDependencies: finalDeps,
    generateReview: async () => mockReview(),
  });
  const second = finalizeLectureSession(session, {
    noteDependencies: finalDeps,
    generateReview: async () => mockReview(),
  });
  assert.equal(first, second);
  await assert.rejects(
    processTranscript(session, {
      itemId: "late-final-transcript",
      sequence: 7,
      text: "final snapshot 이후 발화",
      source: "manual",
      receivedAt: new Date().toISOString(),
      startedAtMs: null,
      endedAtMs: null,
    }),
    /SESSION_NOT_ACCEPTING_TRANSCRIPTS/,
  );
  await Promise.all([first, second]);
  assert.equal(finalComposeCalls, 1);
  assert.equal(session.status, "ended");
  assert.ok(session.noteGeneration.currentNote, "live note remains available");
  assert.equal(session.noteGeneration.finalNote?.status, "final");
  assert.equal(session.noteGeneration.finalNote?.processedThroughSequence, 6);
  assert.equal(session.transcripts.length, 6);
  assert.match(noteTexts(session.noteGeneration.finalNote).join(" "), /O\s*\(log\s*n\)/i);
  assert.equal(session.noteGeneration.nextScheduledAt, null);

  const fallbackSession = makeSession();
  addTranscript(fallbackSession, 1, "원본 대본은 최종 필기 실패에도 보존됩니다.");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await finalizeLectureSession(fallbackSession, {
      noteDependencies: mockDependencies({
        compose: async () => { throw new Error("MOCK_FINAL_FAILURE"); },
      }),
      generateReview: async () => mockReview(),
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(fallbackSession.status, "ended");
  assert.equal(fallbackSession.transcripts.length, 1);
  assert.equal(fallbackSession.noteGeneration.finalNote?.status, "final");
  assert.match(noteTexts(fallbackSession.noteGeneration.finalNote).join(" "), /원본 대본/);
  cleanup(session);
  cleanup(fallbackSession);
}

async function main(): Promise<void> {
  await testBinarySearchCheckpoints();
  await testSnapshotAndNoNewContent();
  await testPendingManualAndFailureCursor();
  await testNegativeEmphasisIsNotPromoted();
  await testToggleAndResetStaleResult();
  await testServerTimerDispatch();
  await testPollingRecoversDroppedTimerWithoutWaitingForModel();
  await testScheduledShortTurnIsReviewed();
  await testLateTranscriptIsNotDropped();
  await testFinalNoteAndDuplicateFinalization();
  console.log("cumulative note generation regression tests passed");
}

void main();
