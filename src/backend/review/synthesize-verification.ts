import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import {
  VerificationSynthesisSchema,
  WebSearchSourceSchema,
  type VerifyClaimArgsSchema,
} from "../schemas";
import type { z } from "zod";

type VerifyArgs = z.infer<typeof VerifyClaimArgsSchema>;
const SearchEvidenceSchema = WebSearchSourceSchema.array().max(3);

// A structured follow-up converts searched evidence into the stable UI verdict.
export async function synthesizeVerification(
  args: VerifyArgs,
  evidence: { answer: string; sources: unknown[] },
) {
  const sources = SearchEvidenceSchema.parse(evidence.sources);
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_FAST_MODEL,
    input: [
      {
        role: "system",
        content:
          "웹 검색으로 확보한 답변과 실제 출처만 사용해 강의 발화와 슬라이드 주장을 비교한다. supports_slide는 근거가 슬라이드 주장을 명확히 지지할 때, supports_lecture는 근거가 발화를 명확히 지지할 때, mixed는 조건이나 출처에 따라 달라질 때, insufficient는 관련 근거가 부족할 때 선택한다. 교수가 틀렸다고 표현하지 말고 한국어로 중립적이고 간결하게 설명한다. correctedStatement에는 근거에 맞는 독립적인 학습 문장을 쓴다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          lectureClaim: args.lectureClaim,
          slideClaim: args.slideClaim,
          webSearchAnswer: evidence.answer,
          sources: sources.map(({ title, url }) => ({ title, url })),
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        VerificationSynthesisSchema,
        "verification_synthesis",
      ),
    },
  });

  if (!response.output_parsed) throw new Error("VERIFICATION_SYNTHESIS_EMPTY");
  return VerificationSynthesisSchema.parse(response.output_parsed);
}
