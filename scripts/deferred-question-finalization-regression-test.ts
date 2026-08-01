import assert from "node:assert/strict";
import {
  createDeferredQuestion,
  finalizeDeferredQuestions,
} from "../src/backend/lecture/understanding/deferred-question-pipeline";
import { TranscriptSchema } from "../src/backend/schemas";
import { createPreparingSession } from "../src/backend/session-store";

async function main() {
  const session = createPreparingSession("수업 맥락을 우선한다.", "ko");
  session.status = "listening";
  session.transcripts.push(TranscriptSchema.parse({
    id: "transcript-1",
    itemId: "item-1",
    sequence: 1,
    text: "이진 탐색은 정렬된 목록의 중간값부터 비교합니다.",
    source: "manual",
    receivedAt: new Date().toISOString(),
    startedAtMs: null,
    endedAtMs: null,
    matchedSlidePages: [],
    matchedSlidePage: null,
    slideConfidence: 0,
  }));

  const saved = createDeferredQuestion(session, {
    question: "왜 정렬이 필요한가요?",
  });
  await finalizeDeferredQuestions(session, {
    judge: async () => ({
      explained: false,
      confidence: 1,
      explanation: "",
      relatedItemIds: [],
    }),
    explain: async () => ({
      title: "정렬이 필요한 이유",
      directAnswer: "비교 한 번으로 탐색 범위의 절반을 제외하려면 정렬이 필요합니다.",
      explanation: "정렬되어 있어야 중간값보다 작은 값과 큰 값의 위치를 확정할 수 있습니다.",
      keyPoints: ["중간값 비교", "절반 제외"],
      example: null,
      basis: "lecture_only",
      referencedItemIds: ["item-1"],
    }),
  });

  assert.equal(saved.question.status, "ai_explanation_available");
  assert.match(saved.question.lectureExplanation ?? "", /정렬/u);
  assert.deepEqual(saved.question.relatedItemIds, ["item-1"]);
  console.log("deferred question finalization regression tests passed");
}

void main();
