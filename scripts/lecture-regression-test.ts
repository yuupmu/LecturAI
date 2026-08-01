import assert from "node:assert/strict";
import { applyLectureStatePatch } from "../src/backend/lecture/apply-lecture-state-patch";
import { buildLectureContext } from "../src/backend/lecture/build-lecture-context";
import { createFallbackNote } from "../src/backend/lecture/notes/note-pipeline";
import { WEB_SEARCH_ENABLED } from "../src/backend/search/openai-web-search";
import {
  LectureStatePatchSchema,
  TranscriptSchema,
  type LectureSession,
  type LectureStatePatch,
  type Transcript,
} from "../src/backend/schemas";
import { createPreparingSession } from "../src/backend/session-store";
import { processTranscript } from "../src/backend/transcript/process-transcript";

type NewKnowledge = LectureStatePatch["newKnowledgeUnits"][number];

function addTranscript(
  session: LectureSession,
  sequence: number,
  text: string,
  itemId = `item-${sequence}`,
): Transcript {
  const transcript = TranscriptSchema.parse({
    id: `turn-${sequence}`,
    itemId,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date(1_700_000_000_000 + sequence * 1_000).toISOString(),
    startedAtMs: null,
    endedAtMs: null,
    matchedSlidePages: [],
    matchedSlidePage: null,
    slideConfidence: 0,
  });
  session.transcripts.push(transcript);
  session.processedItemIds.add(itemId);
  return transcript;
}

function knowledge(
  type: NewKnowledge["type"],
  text: string,
  sourceItemIds: string[],
  options: Partial<Pick<NewKnowledge, "order" | "importance" | "sourcePages">> = {},
): NewKnowledge {
  return {
    type,
    text,
    order: options.order ?? null,
    importance: options.importance ?? "normal",
    sourceItemIds,
    sourcePages: options.sourcePages ?? [],
  };
}

function patchFor(
  session: LectureSession,
  overrides: Partial<LectureStatePatch> = {},
): LectureStatePatch {
  return LectureStatePatchSchema.parse({
    baseRevision: session.lectureMemory.revision,
    activity: "instruction",
    unitDecision: "continue",
    workingUnitTitle: null,
    newKnowledgeUnits: [],
    emphasisUpdates: [],
    pendingEmphasis: null,
    cancelPendingEmphasis: false,
    unitSummary: null,
    ...overrides,
  });
}

function apply(
  session: LectureSession,
  transcript: Transcript,
  overrides: Partial<LectureStatePatch> = {},
) {
  return applyLectureStatePatch(
    session,
    patchFor(session, overrides),
    buildLectureContext(session, transcript),
  );
}

function allNoteItems(note: ReturnType<typeof createFallbackNote>) {
  return note.sections.flatMap((section) => section.items);
}

function testBinarySearchAndTwoStageBoundary(): void {
  const session = createPreparingSession("근거 기반 구조화 필기", "ko");
  const inputs: Array<{
    text: string;
    unit: NewKnowledge;
  }> = [
    {
      text: "이진 탐색의 입력 데이터는 정렬되어 있어야 하며 이 조건은 중요합니다.",
      unit: knowledge("condition", "입력 데이터가 정렬되어 있어야 한다.", ["item-1"], { importance: "important" }),
    },
    {
      text: "먼저 탐색 구간의 중간값을 확인합니다.",
      unit: knowledge("process", "탐색 구간의 중간값을 확인한다.", ["item-2"], { order: 1 }),
    },
    {
      text: "그 다음 목표값과 중간값을 비교합니다.",
      unit: knowledge("process", "목표값과 중간값을 비교한다.", ["item-3"], { order: 2 }),
    },
    {
      text: "비교 결과에 따라 필요 없는 절반을 제거합니다.",
      unit: knowledge("process", "비교 결과에 따라 필요 없는 절반을 제거한다.", ["item-4"], { order: 3 }),
    },
    {
      text: "매 단계에서 탐색 범위가 절반으로 감소합니다.",
      unit: knowledge("complexity", "매 단계에서 탐색 범위가 절반으로 감소한다.", ["item-5"]),
    },
    {
      text: "최악 시간복잡도 O(log n)은 시험에 나옵니다.",
      unit: knowledge("complexity", "최악 시간복잡도는 O(log n)이다.", ["item-6"], { importance: "exam" }),
    },
  ];

  for (let index = 0; index < inputs.length; index += 1) {
    const sequence = index + 1;
    const transcript = addTranscript(session, sequence, inputs[index].text);
    apply(session, transcript, {
      workingUnitTitle: index === 0 ? "Binary Search" : null,
      newKnowledgeUnits: [inputs[index].unit],
    });
    assert.equal(session.lectureMemory.completedUnits.length, 0);
  }

  const transition = addTranscript(session, 7, "다음으로 해시 탐색을 보겠습니다.");
  apply(session, transition, {
    unitDecision: "close_and_start",
    workingUnitTitle: "Hash Search",
    newKnowledgeUnits: [
      knowledge("definition", "해시 탐색은 해시 값을 이용한다.", ["item-7"]),
    ],
  });
  assert.equal(session.lectureMemory.currentUnit?.status, "closing_candidate");
  assert.equal(session.lectureMemory.completedUnits.length, 0, "첫 경계 판정은 확정하면 안 됨");

  const confirmation = addTranscript(session, 8, "해시 함수가 키를 위치에 대응시킵니다.");
  const result = apply(session, confirmation, {
    unitDecision: "close_and_start",
    workingUnitTitle: "Hash Search",
    newKnowledgeUnits: [
      knowledge("definition", "해시 함수가 키를 위치에 대응시킨다.", ["item-8"]),
    ],
  });
  assert.ok(result.finalizedUnit);
  assert.equal(session.lectureMemory.completedUnits.length, 1);
  assert.equal(session.lectureMemory.currentUnit?.workingTitle, "Hash Search");

  const note = createFallbackNote(result.finalizedUnit);
  const noteText = allNoteItems(note).map((item) => item.text).join(" ");
  assert.match(note.title, /Binary Search|이진 탐색/iu);
  assert.match(noteText, /정렬/);
  assert.match(noteText, /중간값/);
  assert.match(noteText, /목표값.*비교/);
  assert.match(noteText, /절반.*제거/);
  assert.match(noteText, /범위.*절반.*감소/);
  assert.match(noteText, /O\s*\(log\s*n\)/iu);
  const steps = note.sections.find((section) => section.layout === "steps")?.items ?? [];
  assert.deepEqual(
    steps.map((item) => item.text),
    [
      "탐색 구간의 중간값을 확인한다.",
      "목표값과 중간값을 비교한다.",
      "비교 결과에 따라 필요 없는 절반을 제거한다.",
    ],
  );
  assert.notEqual(allNoteItems(note).find((item) => /정렬/.test(item.text))?.importance, "normal");
  assert.notEqual(allNoteItems(note).find((item) => /O\s*\(log/iu.test(item.text))?.importance, "normal");
  assert.equal(allNoteItems(note).length, inputs.length, "근거 없는 추가 지식 금지");
}

function testUnitDecisionsAndEmphasis(): void {
  const session = createPreparingSession("강의 단원을 추적", "ko");
  const first = addTranscript(session, 1, "스택은 후입선출 구조입니다.");
  apply(session, first, {
    workingUnitTitle: "Stack",
    newKnowledgeUnits: [knowledge("definition", "스택은 후입선출 구조이다.", [first.itemId])],
  });

  const filler = addTranscript(session, 2, "음.");
  apply(session, filler, {
    activity: "off_topic",
    unitDecision: "continue",
    newKnowledgeUnits: [knowledge("conclusion", "음은 핵심 지식이다.", [filler.itemId])],
  });
  assert.equal(session.lectureMemory.currentUnit?.provisionalKnowledge.length, 1);

  const candidate = addTranscript(session, 3, "정리하면 후입선출입니다.");
  apply(session, candidate, { unitDecision: "close_candidate" });
  assert.equal(session.lectureMemory.currentUnit?.status, "closing_candidate");
  const example = addTranscript(session, 4, "예를 들어 접시 더미를 생각하면 됩니다.");
  apply(session, example, {
    activity: "example",
    unitDecision: "continue",
    newKnowledgeUnits: [knowledge("example", "접시 더미는 스택의 예시이다.", [example.itemId])],
  });
  assert.equal(session.lectureMemory.currentUnit?.status, "open");
  assert.equal(session.lectureMemory.completedUnits.length, 0);

  const second = addTranscript(session, 5, "스택의 삽입은 push입니다.");
  apply(session, second, {
    newKnowledgeUnits: [knowledge("process", "스택에 값을 삽입하는 연산은 push이다.", [second.itemId])],
  });
  const emphasis = addTranscript(session, 6, "방금 말한 두 가지는 시험에 냅니다.");
  apply(session, emphasis, {
    activity: "class_administration",
    emphasisUpdates: [{
      targetSourceItemIds: [first.itemId, second.itemId],
      targetKnowledgeUnitIds: [],
      importance: "exam",
      reason: "직전 두 가지에 대한 명시적 시험 강조",
    }],
  });
  const current = session.lectureMemory.currentUnit;
  assert.ok(current);
  assert.equal(current.provisionalKnowledge.find((item) => item.sourceItemIds.includes(first.itemId))?.importance, "exam");
  assert.equal(current.provisionalKnowledge.find((item) => item.sourceItemIds.includes(second.itemId))?.importance, "exam");

  const forward = addTranscript(session, 7, "다음 두 가지는 시험에 냅니다.");
  apply(session, forward, {
    activity: "class_administration",
    pendingEmphasis: {
      importance: "exam",
      expectedCount: 2,
      triggerItemIds: [forward.itemId],
    },
  });
  const next = addTranscript(session, 8, "큐는 enqueue와 dequeue 연산을 사용합니다.");
  apply(session, next, {
    newKnowledgeUnits: [
      knowledge("process", "큐에 값을 넣는 연산은 enqueue이다.", [next.itemId], { order: 1 }),
      knowledge("process", "큐에서 값을 꺼내는 연산은 dequeue이다.", [next.itemId], { order: 2 }),
    ],
  });
  const forwardUnits = session.lectureMemory.currentUnit?.provisionalKnowledge
    .filter((item) => item.sourceItemIds.includes(next.itemId)) ?? [];
  assert.equal(forwardUnits.length, 2);
  assert.ok(forwardUnits.every((item) => item.importance === "exam"));
  assert.equal(session.lectureMemory.currentUnit?.pendingEmphasis, null);

  const ordinary = addTranscript(session, 9, "이 연산 이름은 참고만 하세요.");
  apply(session, ordinary, {
    newKnowledgeUnits: [knowledge("warning", "연산 이름은 참고 사항이다.", [ordinary.itemId])],
  });
  const negative = addTranscript(session, 10, "시험에 나오지 않습니다.");
  apply(session, negative, {
    activity: "class_administration",
    emphasisUpdates: [{
      targetSourceItemIds: [ordinary.itemId],
      targetKnowledgeUnitIds: [],
      importance: "exam",
      reason: "모델이 잘못 해석한 부정 강조",
    }],
  });
  assert.equal(
    session.lectureMemory.currentUnit?.provisionalKnowledge.find(
      (item) => item.sourceItemIds.includes(ordinary.itemId),
    )?.importance,
    "normal",
  );

  const cancelForward = addTranscript(session, 11, "다음 한 가지는 시험에 냅니다.");
  apply(session, cancelForward, {
    activity: "class_administration",
    pendingEmphasis: {
      importance: "exam",
      expectedCount: 1,
      triggerItemIds: [cancelForward.itemId],
    },
  });
  const cancel = addTranscript(session, 12, "방금 말은 취소합니다. 시험에 나오지 않습니다.");
  apply(session, cancel, {
    activity: "class_administration",
    cancelPendingEmphasis: true,
  });
  const afterCancel = addTranscript(session, 13, "큐는 선입선출 구조입니다.");
  apply(session, afterCancel, {
    newKnowledgeUnits: [knowledge("definition", "큐는 선입선출 구조이다.", [afterCancel.itemId])],
  });
  assert.equal(
    session.lectureMemory.currentUnit?.provisionalKnowledge.find(
      (item) => item.sourceItemIds.includes(afterCancel.itemId),
    )?.importance,
    "normal",
  );

  const pronoun = addTranscript(session, 14, "이것이 중요합니다.");
  const beforePronoun = session.lectureMemory.currentUnit?.provisionalKnowledge.length;
  apply(session, pronoun, {
    newKnowledgeUnits: [knowledge("conclusion", "이것이 중요하다.", [pronoun.itemId])],
  });
  assert.equal(session.lectureMemory.currentUnit?.provisionalKnowledge.length, beforePronoun);

  const duplicate = addTranscript(session, 15, "스택은 LIFO입니다.");
  const beforeDuplicate = session.lectureMemory.currentUnit?.provisionalKnowledge.length ?? 0;
  apply(session, duplicate, {
    newKnowledgeUnits: [knowledge("definition", "스택은 후입선출 구조이다.", [duplicate.itemId])],
  });
  assert.equal(session.lectureMemory.currentUnit?.provisionalKnowledge.length, beforeDuplicate);

  const staleBase = session.lectureMemory.revision - 1;
  const revision = session.lectureMemory.revision;
  const staleTranscript = addTranscript(session, 16, "오래된 결과입니다.");
  const stale = applyLectureStatePatch(
    session,
    patchFor(session, { baseRevision: staleBase }),
    buildLectureContext(session, staleTranscript),
  );
  assert.equal(stale.applied, false);
  assert.equal(session.lectureMemory.revision, revision);
}

function testRepeatedUncertainCandidateDoesNotFinalize(): void {
  const session = createPreparingSession("불확실한 경계는 기다립니다", "ko");
  const first = addTranscript(session, 1, "그래프는 정점과 간선으로 구성됩니다.");
  apply(session, first, {
    workingUnitTitle: "Graph",
    newKnowledgeUnits: [
      knowledge("definition", "그래프는 정점과 간선으로 구성된다.", [first.itemId]),
    ],
  });
  const candidate = addTranscript(session, 2, "여기까지가 기본 설명일 수 있습니다.");
  apply(session, candidate, { unitDecision: "close_candidate" });
  const stillUncertain = addTranscript(session, 3, "조금 더 정리해 보겠습니다.");
  apply(session, stillUncertain, { unitDecision: "close_candidate" });
  assert.equal(session.lectureMemory.completedUnits.length, 0);
  assert.equal(session.lectureMemory.currentUnit?.status, "closing_candidate");
}

async function testTranscriptPersistenceDoesNotInvokeInterpreter(): Promise<void> {
  const session = createPreparingSession("원본 대본 보존", "ko");
  session.status = "ready";
  const result = await processTranscript(session, {
    itemId: "immutable-item",
    sequence: 1,
    text: "자막 저장만으로 필기 모델을 호출하지 않습니다.",
    source: "manual",
    receivedAt: new Date().toISOString(),
    startedAtMs: null,
    endedAtMs: null,
  });
  assert.equal(result.action, "none");
  assert.equal(session.transcripts.length, 1);
  assert.equal(session.transcripts[0].text, "자막 저장만으로 필기 모델을 호출하지 않습니다.");
  assert.ok(session.rawLogs.some((log) => log.name === "transcript_saved"));
  assert.ok(session.rawLogs.some((log) => log.name === "note_schedule_started"));
  assert.ok(!session.rawLogs.some((log) => log.name === "lecture_context_built"));
  assert.equal(session.lectureMemory.revision, 0);
  if (session.noteGenerationTimer) clearTimeout(session.noteGenerationTimer);
}

async function main(): Promise<void> {
  assert.equal(WEB_SEARCH_ENABLED, false, "1단계에서는 웹 검색이 항상 비활성화되어야 함");
  testBinarySearchAndTwoStageBoundary();
  testUnitDecisionsAndEmphasis();
  testRepeatedUncertainCandidateDoesNotFinalize();
  await testTranscriptPersistenceDoesNotInvokeInterpreter();
  console.log("lecture regression tests passed");
}

void main();
