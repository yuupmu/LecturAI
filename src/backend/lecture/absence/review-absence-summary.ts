import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  AbsenceSummaryReviewSchema,
  type AbsenceSummaryDraft,
  type AbsenceSummaryReview,
} from "../../schemas";
import type { AbsenceSummaryContext } from "./build-absence-context";

export type AbsenceSummaryReviewer = (
  context: AbsenceSummaryContext,
  draft: AbsenceSummaryDraft,
) => Promise<AbsenceSummaryReview>;

export async function reviewAbsenceSummary(
  context: AbsenceSummaryContext,
  draft: AbsenceSummaryDraft,
): Promise<AbsenceSummaryReview> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `부재 요약 Grounding Reviewer다. 실제 부재 sequence 범위의 내용인지, 전후 문맥을 새 내용으로 섞지 않았는지, 없는 내용을 추가했는지, 중요한 설명과 강조를 누락했는지, 잡담을 핵심으로 잘못 분류했는지, 복귀 시점 위치가 맞는지 검사한다. 불합격이면 한 번의 수정에 필요한 구체적인 지시를 반환한다.`,
      },
      { role: "user", content: JSON.stringify({ context, draft }) },
    ],
    text: {
      format: zodTextFormat(AbsenceSummaryReviewSchema, "absence_summary_review"),
    },
  });
  if (!response.output_parsed) throw new Error("ABSENCE_REVIEW_EMPTY_OUTPUT");
  return AbsenceSummaryReviewSchema.parse(response.output_parsed);
}
