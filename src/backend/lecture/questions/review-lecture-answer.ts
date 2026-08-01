import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  LectureAnswerReviewSchema,
  type LectureAnswerDraft,
  type LectureAnswerReview,
} from "../../schemas";
import type { LectureQuestionContext } from "./build-question-context";

export type LectureQuestionReviewer = (
  context: LectureQuestionContext,
  draft: LectureAnswerDraft,
) => Promise<LectureAnswerReview>;

export async function reviewLectureAnswer(
  context: LectureQuestionContext,
  draft: LectureAnswerDraft,
): Promise<LectureAnswerReview> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `질문 답변의 Grounding Reviewer다. 답변이 질문 시점의 제공 문맥에만 근거하는지 검사한다.

질문에 직접 답했는지, 일반 지식을 추가했는지, 근거가 실제 관련 있는지, 이후 내용을 섞었는지, 자료 부족에도 단정했는지, 스타일이 사실을 왜곡했는지 검사한다. evidenceRefs의 배열 인덱스 중 지원되지 않는 근거를 unsupportedEvidenceIndexes에 적는다. 안전하게 한 번 수정할 구체적인 지시만 반환한다.`,
      },
      {
        role: "user",
        content: JSON.stringify({ context, draft }),
      },
    ],
    text: {
      format: zodTextFormat(LectureAnswerReviewSchema, "lecture_answer_review"),
    },
  });
  if (!response.output_parsed) throw new Error("LECTURE_ANSWER_REVIEW_EMPTY_OUTPUT");
  return LectureAnswerReviewSchema.parse(response.output_parsed);
}
