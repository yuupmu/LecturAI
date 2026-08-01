import assert from "node:assert/strict";
import {
  addUnderstandingBranchMessage,
  rejoinUnderstandingBranch,
  startUnderstandingBranch,
} from "../src/backend/lecture/understanding/branch-pipeline";
import {
  createDeferredQuestion,
  scheduleDeferredQuestionChecks,
  updateDeferredQuestion,
} from "../src/backend/lecture/understanding/deferred-question-pipeline";
import {
  TranscriptSchema,
  type LectureAssistantModelAnswer,
  type LectureSession,
  type TranscriptSelectionContext,
  type UnderstandingRejoinDraft,
} from "../src/backend/schemas";
import {
  createPreparingSession,
  resetSession,
} from "../src/backend/session-store";

function appendTranscript(
  session: LectureSession,
  sequence: number,
  text: string,
): string {
  const itemId = `item-${sequence}`;
  session.transcripts.push(TranscriptSchema.parse({
    id: `transcript-${sequence}`,
    itemId,
    sequence,
    text,
    source: "manual",
    receivedAt: new Date(Date.now() + sequence * 1_000).toISOString(),
    startedAtMs: null,
    endedAtMs: null,
    matchedSlidePages: [],
    matchedSlidePage: null,
    slideConfidence: 0,
  }));
  session.processedItemIds.add(itemId);
  session.lectureRevision += 1;
  return itemId;
}

function answer(title: string): LectureAssistantModelAnswer {
  return {
    title,
    directAnswer: "탐색 범위를 절반씩 줄이는 원리를 설명합니다.",
    explanation: "정렬되어 있으면 중간값 비교로 한쪽 절반을 안전하게 제외할 수 있습니다.",
    keyPoints: ["정렬 상태", "중간값 비교", "절반 제외"],
    example: "전화번호부의 가운데를 먼저 펼치는 경우",
    basis: "lecture_plus_general_knowledge",
    referencedItemIds: ["item-1"],
  };
}

async function main() {
  const session = createPreparingSession("수업 맥락을 우선한다.", "ko");
  session.status = "listening";
  appendTranscript(
    session,
    1,
    "이진 탐색은 정렬된 데이터에서 중간값을 비교해 범위를 절반으로 줄입니다.",
  );
  const selection: TranscriptSelectionContext = {
    selectedText: "범위를 절반으로 줄입니다",
    sourceItemIds: ["item-1"],
    startSequence: 1,
    endSequence: 1,
    kind: "original",
    targetLanguage: null,
    translationIds: [],
    intent: "explain",
  };

  const dependencies = {
    explain: async () => answer("왜 절반으로 줄어드나요?"),
    composeRejoin: async (): Promise<UnderstandingRejoinDraft> => ({
      understoodContent: ["정렬 덕분에 절반을 제외할 수 있습니다."],
      lectureProgress: ["정렬 유지 비용을 설명했습니다."],
      currentLecturePosition: "삽입과 삭제 비용을 설명하는 중입니다.",
      connection: "빠른 탐색과 정렬 유지 비용을 함께 비교하면 됩니다.",
      listenFor: ["탐색 비용과 갱신 비용의 trade-off"],
      sourceItemIds: ["item-2"],
    }),
  };
  const started = startUnderstandingBranch(session, { selection }, dependencies);
  assert.equal(started.accepted, true);
  assert.equal(started.branch.startedAtSequence, 1);
  const duplicate = startUnderstandingBranch(session, { selection }, dependencies);
  assert.equal(duplicate.accepted, false, "한 세션에 active 즉시 분기는 하나만 허용해야 한다");
  await session.understandingBranchChain;
  assert.equal(started.branch.explanationStatus, "answered");

  addUnderstandingBranchMessage(
    session,
    started.branch.id,
    "정렬되지 않으면 왜 안 되나요?",
    dependencies,
  );
  await session.understandingBranchChain;
  assert.equal(started.branch.messages.filter((message) => message.role === "user").length, 1);

  appendTranscript(session, 2, "이제 정렬 상태를 유지하는 삽입 비용도 생각해 봅시다.");
  appendTranscript(session, 3, "삭제가 많으면 정렬 배열이 항상 유리하지는 않습니다.");
  let resolveRejoin: ((draft: UnderstandingRejoinDraft) => void) | undefined;
  const delayedRejoin = new Promise<UnderstandingRejoinDraft>((resolve) => {
    resolveRejoin = resolve;
  });
  const rejoin = rejoinUnderstandingBranch(session, started.branch.id, {
    ...dependencies,
    composeRejoin: async () => delayedRejoin,
  });
  assert.equal(rejoin.branch.endedAtSequence, 3);
  appendTranscript(session, 4, "이 발화는 합류 버튼 뒤에 도착했습니다.");
  resolveRejoin?.({
    understoodContent: ["절반 제외 원리"],
    lectureProgress: ["정렬 유지 비용"],
    currentLecturePosition: "삭제 비용",
    connection: "탐색과 갱신 비용을 연결합니다.",
    listenFor: ["trade-off"],
    sourceItemIds: ["item-2", "item-4"],
  });
  await session.understandingBranchChain;
  assert.equal(started.branch.status, "completed");
  assert.deepEqual(
    started.branch.rejoinPacket?.sourceItemIds,
    ["item-2"],
    "합류 클릭 뒤 도착한 발화는 고정된 범위에 포함하면 안 된다",
  );
  assert.deepEqual(
    started.branch.rejoinPacket?.rawTranscript.map((turn) => turn.sequence),
    [2, 3],
  );

  const deferred = createDeferredQuestion(session, {
    question: "lower bound와 일반 이진 탐색은 어떻게 다른가요?",
  });
  assert.equal(deferred.question.status, "pending");
  for (let sequence = 5; sequence <= 9; sequence += 1) {
    appendTranscript(session, sequence, `후속 설명 ${sequence}`);
  }
  scheduleDeferredQuestionChecks(session, async (context) => ({
    explained: true,
    confidence: 0.9,
    explanation: "교수자가 lower bound는 첫 위치를 찾는 변형이라고 설명했습니다.",
    relatedItemIds: [context.subsequentTranscript.at(-1)?.itemId ?? ""],
  }));
  await session.deferredQuestionChain;
  assert.equal(deferred.question.status, "explained_by_lecture");
  assert.deepEqual(deferred.question.relatedSequences, [9]);
  updateDeferredQuestion(session, deferred.question.id, "resolve");
  assert.equal(deferred.question.status, "resolved");

  const unresolved = createDeferredQuestion(session, {
    question: "이후 수업에 나오지 않는 질문입니다.",
  });
  for (let sequence = 10; sequence <= 14; sequence += 1) {
    appendTranscript(session, sequence, `관계없는 후속 발화 ${sequence}`);
  }
  scheduleDeferredQuestionChecks(session, async () => ({
    explained: false,
    confidence: 0.95,
    explanation: "",
    relatedItemIds: [],
  }));
  await session.deferredQuestionChain;
  assert.equal(unresolved.question.status, "ai_explanation_available");

  const failedCheck = createDeferredQuestion(session, {
    question: "판정 실패 뒤 다시 시도할 수 있어야 합니다.",
  });
  for (let sequence = 15; sequence <= 19; sequence += 1) {
    appendTranscript(session, sequence, `판정 실패 테스트 발화 ${sequence}`);
  }
  scheduleDeferredQuestionChecks(session, async () => {
    throw new Error("mock deferred decision failure");
  });
  await session.deferredQuestionChain;
  assert.equal(failedCheck.question.status, "failed");
  assert.match(failedCheck.question.errorMessage ?? "", /다시 확인/u);

  const fallbackBranch = startUnderstandingBranch(session, {}, dependencies);
  await session.understandingBranchChain;
  session.status = "ended";
  const fallbackRejoin = rejoinUnderstandingBranch(
    session,
    fallbackBranch.branch.id,
    {
      ...dependencies,
      composeRejoin: async () => {
        throw new Error("mock rejoin failure");
      },
    },
  );
  const duplicateRejoin = rejoinUnderstandingBranch(
    session,
    fallbackBranch.branch.id,
    dependencies,
  );
  assert.equal(duplicateRejoin.accepted, false);
  await session.understandingBranchChain;
  assert.equal(fallbackRejoin.branch.status, "completed");
  assert.equal(fallbackRejoin.branch.rejoinPacket?.fallback, true);
  assert.deepEqual(
    fallbackRejoin.branch.rejoinPacket?.rawTranscript,
    [],
    "새 발화 없는 합류도 안전하게 완료해야 한다",
  );
  session.status = "listening";

  let resolveStale: ((value: LectureAssistantModelAnswer) => void) | undefined;
  const staleAnswer = new Promise<LectureAssistantModelAnswer>((resolve) => {
    resolveStale = resolve;
  });
  const staleBranch = startUnderstandingBranch(session, {}, {
    ...dependencies,
    explain: async () => staleAnswer,
  });
  assert.equal(staleBranch.accepted, true);
  const reset = resetSession(session);
  resolveStale?.(answer("오래된 응답"));
  await reset;
  await session.understandingBranchChain;
  assert.equal(session.understandingBranches.length, 0);
  assert.equal(session.deferredQuestions.length, 0);
  assert.equal(session.transcripts.length, 0);

  console.log("understanding branch regression tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
