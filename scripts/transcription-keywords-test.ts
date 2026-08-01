import assert from "node:assert/strict";
import { buildTranscriptionKeywords } from "../src/backend/realtime/create-transcription-token";
import { SlideMapSchema } from "../src/backend/schemas";

// Formula punctuation is removed before hints reach the Realtime token API.
const slideMap = SlideMapSchema.parse({
  documentTitle: "이진 탐색",
  documentSummary: "키워드 정규화 테스트",
  language: "ko",
  globalKeywords: ["O(log n)", "lower/upper bound", "!!!"],
  slides: [
    {
      page: 1,
      title: "복잡도",
      summary: "",
      keyConcepts: ["과정: 비교 → 버림 → 반복", "o(log n)"],
      factualClaims: [],
      keywords: ["비교 예시: 21 < 42, 31 < 42", "정렬된 배열"],
    },
  ],
});

const keywords = buildTranscriptionKeywords(slideMap);
assert.deepEqual(keywords, [
  "O log n",
  "lower upper bound",
  "비교 예시 21 42 31 42",
  "정렬된 배열",
  "과정 비교 버림 반복",
]);
assert.ok(
  keywords.every((keyword) => /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(keyword)),
);

console.log("Realtime transcription keyword tests passed");
