import assert from "node:assert/strict";
import {
  enqueueLectureAssistantRequest,
  InvalidTranscriptSelectionError,
  validateTranscriptSelection,
} from "../src/backend/lecture/assistant/assistant-pipeline";
import {
  formatAssistantInput,
  type LectureAssistantGenerator,
} from "../src/backend/lecture/assistant/answer-lecture-question";
import { buildFullLectureContext } from "../src/backend/lecture/assistant/build-full-lecture-context";
import {
  LectureNoteSchema,
  TranscriptSchema,
  type LectureAssistantModelAnswer,
  type LectureSession,
  type Transcript,
} from "../src/backend/schemas";
import {
  createPreparingSession,
  makeSessionReady,
  resetSession,
} from "../src/backend/session-store";

const binarySearchLines = [
  "이진 탐색은 정렬된 데이터에서 사용할 수 있습니다.",
  "먼저 탐색 구간의 가운데 값을 확인합니다.",
  "목표값과 가운데 값을 비교합니다.",
  "비교 결과에 따라 필요 없는 절반을 제거합니다.",
  "매 단계마다 탐색 범위가 절반으로 감소합니다.",
  "따라서 최악 시간복잡도는 O(log n)입니다.",
];

function makeTranscript(sequence: number, text: string): Transcript {
  return TranscriptSchema.parse({
    id: `transcript-${sequence}`,
    itemId: `item-${sequence}`,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    startedAtMs: sequence * 1_000,
    endedAtMs: sequence * 1_000 + 900,
    matchedSlidePages: [1],
    matchedSlidePage: 1,
    slideConfidence: 1,
  });
}

function createMockSession(lines = binarySearchLines): LectureSession {
  const session = createPreparingSession(
    "수업의 용어를 우선하되 학생에게 이해하기 쉽게 설명해줘.",
    "ko",
  );
  makeSessionReady(
    session,
    {
      documentTitle: "이진 탐색",
      documentSummary: "정렬된 데이터에서 탐색 범위를 절반씩 줄인다.",
      language: "ko",
      globalKeywords: ["이진 탐색", "O(log n)"],
      slides: [{
        page: 1,
        title: "이진 탐색의 복잡도",
        summary: "탐색 범위를 절반으로 줄인다.",
        keyConcepts: ["binary search"],
        factualClaims: [{
          id: "claim-1",
          text: "이진 탐색의 시간복잡도는 O(log n)이다.",
          type: "fact",
        }],
        keywords: ["이진 탐색"],
      }],
    },
    {
      title: "이진 탐색",
      summary: "정렬된 데이터에서 범위를 절반씩 줄이는 탐색 방법",
      outline: [{
        id: "topic-1",
        title: "시간복잡도",
        summary: "매 단계 탐색 후보가 절반으로 감소한다.",
        definitions: [],
        conditions: [{
          id: "p1-condition-1",
          text: "데이터가 정렬되어 있어야 한다.",
          sourcePage: 1,
          sourceText: "정렬된 데이터",
        }],
        processes: [],
        formulas: [{
          id: "p1-formula-1",
          text: "k = log₂n",
          sourcePage: 1,
          sourceText: "k = log₂n",
        }],
        comparisons: [],
        examples: [],
        warnings: [],
        sourcePages: [1],
      }],
      terminology: [],
    },
  );
  session.transcripts = lines.map((line, index) =>
    makeTranscript(index + 1, line)
  );
  session.noteGeneration.currentNote = LectureNoteSchema.parse({
    id: "note-1",
    unitId: "unit-1",
    status: "live",
    title: "이진 탐색",
    sections: [{
      id: "section-1",
      heading: "핵심",
      layout: "bullets",
      items: [{
        id: "note-item-1",
        text: "한 단계마다 후보 수가 절반이 된다.",
        importance: "normal",
        sourceItemIds: ["item-5"],
        sourcePages: [1],
      }],
    }],
    sourceItemIds: ["item-5"],
    sourcePages: [1],
    processedThroughSequence: 5,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
  });
  return session;
}

function binarySearchAnswer(
  overrides: Partial<LectureAssistantModelAnswer> = {},
): LectureAssistantModelAnswer {
  return {
    title: "탐색 범위가 절반씩 줄기 때문입니다",
    directAnswer: "한 단계마다 n → n/2 → n/4로 후보 수가 줄어듭니다.",
    explanation:
      "k번 뒤 후보 수는 n/2^k이고 하나가 남을 때 n/2^k = 1이므로 k = log₂n입니다. 따라서 최악 시간복잡도는 O(log n)입니다.",
    keyPoints: ["매 단계 절반 제거", "반복 횟수는 log₂n"],
    example: "n=16이면 16 → 8 → 4 → 2 → 1로 네 단계가 필요합니다.",
    basis: "lecture_only",
    referencedItemIds: ["item-4", "item-5", "item-6"],
    ...overrides,
  };
}

async function testFullSnapshotAndBinarySearchAnswer(): Promise<void> {
  const session = createMockSession();
  let capturedSequences: number[] = [];
  const generator: LectureAssistantGenerator = async (context) => {
    capturedSequences = context.fullTranscript.map((turn) => turn.sequence);
    assert.equal(context.materialKnowledge?.title, "이진 탐색");
    assert.equal(context.currentNote?.id, "note-1");
    assert.equal(context.question, "왜 O(log n)인가요?");
    return binarySearchAnswer({
      referencedItemIds: ["item-5", "item-6", "future-item", "missing-item"],
    });
  };

  const result = enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "왜 O(log n)인가요?" },
    generator,
  );
  assert.equal(result.request.snapshotSequence, 6);

  // This transcript arrives after the request and must never enter its context.
  session.transcripts.push(makeTranscript(7, "새 질문 이후에 들어온 발화입니다."));
  session.noteGeneration.currentNote = null;
  await session.assistantChain;

  assert.deepEqual(capturedSequences, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.request.status, "answered");
  assert.match(result.request.answer?.explanation ?? "", /n\/2\^k/);
  assert.deepEqual(result.request.answer?.referencedItemIds, ["item-5", "item-6"]);
  assert.ok(
    session.rawLogs.some((log) => log.name === "assistant_response_rejected"),
  );
}

async function testSelectionExplanationUsesCommonContext(): Promise<void> {
  const session = createMockSession();
  const selection = validateTranscriptSelection(session, {
    selectedText: binarySearchLines[4],
    sourceItemIds: ["item-5"],
    startSequence: 5,
    endSequence: 5,
  }, 6);
  assert.equal(selection.selectedText, binarySearchLines[4]);

  const result = enqueueLectureAssistantRequest(
    session,
    {
      mode: "explain_selection",
      selectedText: selection.selectedText,
      sourceItemIds: selection.sourceItemIds,
      startSequence: selection.startSequence,
      endSequence: selection.endSequence,
    },
    async (context) => {
      assert.equal(context.fullTranscript.length, 6);
      const input = formatAssistantInput(context);
      assert.match(input, /<full_lecture_transcript>/);
      assert.match(input, /<highlighted_transcript>/);
      assert.match(input, /매 단계마다 탐색 범위가 절반으로 감소합니다/);
      return binarySearchAnswer({
        title: "선택 문장의 의미",
        basis: "lecture_plus_general_knowledge",
        referencedItemIds: ["item-5", "item-6"],
      });
    },
  );
  await session.assistantChain;
  assert.equal(result.request.answer?.basis, "lecture_plus_general_knowledge");
}

async function testGeneralKnowledgeIsAllowed(): Promise<void> {
  const session = createMockSession();
  const result = enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "연결 리스트에서도 효율적인가요?" },
    async () => binarySearchAnswer({
      title: "연결 리스트에서는 보통 효율적이지 않습니다",
      directAnswer:
        "원리적으로 적용할 수 있지만 일반 연결 리스트는 중간 원소에 즉시 접근하기 어려워 배열만큼 효율적이지 않습니다.",
      basis: "lecture_plus_general_knowledge",
      referencedItemIds: ["item-1"],
    }),
  );
  await session.assistantChain;
  assert.equal(result.request.status, "answered");
  assert.equal(result.request.answer?.basis, "lecture_plus_general_knowledge");
  assert.match(result.request.answer?.directAnswer ?? "", /중간 원소/);
}

async function testDuplicateAndFailureIsolation(): Promise<void> {
  const session = createMockSession([binarySearchLines[0]]);
  let release!: (answer: LectureAssistantModelAnswer) => void;
  const pendingAnswer = new Promise<LectureAssistantModelAnswer>((resolve) => {
    release = resolve;
  });
  const first = enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "중복 질문" },
    async () => pendingAnswer,
  );
  const duplicate = enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "중복 질문" },
    async () => binarySearchAnswer(),
  );
  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.request.id, first.request.id);

  session.transcripts.push(makeTranscript(2, "답변 중에도 저장되는 새 발화"));
  assert.equal(session.transcripts.at(-1)?.sequence, 2);
  release(binarySearchAnswer());
  await session.assistantChain;
  assert.equal(first.request.status, "answered");

  const failed = enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "실패 격리" },
    async () => {
      throw new Error("MOCK_MODEL_FAILURE");
    },
  );
  await session.assistantChain;
  assert.equal(failed.request.status, "failed");
  assert.equal(session.transcripts.length, 2);
}

async function testInvalidSelectionAndResetStaleResponse(): Promise<void> {
  const session = createMockSession();
  assert.throws(
    () => validateTranscriptSelection(session, {
      selectedText: "임시 delta 자막",
      sourceItemIds: ["partial-item"],
      startSequence: 99,
      endSequence: 99,
    }, 6),
    InvalidTranscriptSelectionError,
  );

  let started!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: (answer: LectureAssistantModelAnswer) => void;
  const pendingAnswer = new Promise<LectureAssistantModelAnswer>((resolve) => {
    release = resolve;
  });
  enqueueLectureAssistantRequest(
    session,
    { mode: "question", question: "reset 전 질문" },
    async () => {
      started();
      return pendingAnswer;
    },
  );
  await didStart;
  await resetSession(session);
  release(binarySearchAnswer());
  await Promise.resolve();
  assert.equal(session.assistantRequests.length, 0);
}

async function main(): Promise<void> {
  const directContext = buildFullLectureContext(createMockSession(), {
    mode: "question",
    snapshotSequence: 4,
    question: "스냅샷 확인",
    selection: null,
  });
  assert.deepEqual(
    directContext.fullTranscript.map((turn) => turn.sequence),
    [1, 2, 3, 4],
  );

  await testFullSnapshotAndBinarySearchAnswer();
  await testSelectionExplanationUsesCommonContext();
  await testGeneralKnowledgeIsAllowed();
  await testDuplicateAndFailureIsolation();
  await testInvalidSelectionAndResetStaleResponse();
  console.log("assistant regression mock tests passed");
}

void main();
