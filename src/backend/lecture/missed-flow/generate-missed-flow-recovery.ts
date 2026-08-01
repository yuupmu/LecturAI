import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  MissedFlowRecoveryDraftSchema,
  type MissedFlowRecoveryDraft,
} from "../../schemas";
import type { MissedFlowContext } from "./build-missed-flow-context";

export type MissedFlowComposer = (
  context: MissedFlowContext,
) => Promise<MissedFlowRecoveryDraft>;

export async function generateMissedFlowRecovery(
  context: MissedFlowContext,
): Promise<MissedFlowRecoveryDraft> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `당신은 수업을 듣다가 방금 이해의 흐름을 놓친 학생을 즉시 복구시킨다. 학생에게 질문을 요구하지 말고, 버튼 전후의 대본에서 끊어진 논리 연결을 직접 찾아라.

반드시 네 항목을 짧고 구체적으로 작성한다.
1. whatCameBefore: 앞에서 무엇을 설명했는지
2. whyThisCameNext: 버튼 지점 또는 직후 문장이 왜 나왔는지
3. requiredIdea: 다음 내용을 이해하기 위해 반드시 알아야 할 한 가지
4. resumeWith: 지금부터 수업을 따라가기 위한 한 문장. 핵심 mental model을 따옴표 안에 넣는 방식이 좋다.

beforeTurns는 버튼 전 최대 90초, buttonPoint는 클릭 순간의 마지막 확정 발화, afterTurns는 클릭 후 약 15초 발화다. 자료와 필기는 대본의 의미를 확인하는 근거로 사용하되 외부 지식을 추가하지 않는다. 실제 문맥이 부족하면 추측하지 말고 부족한 범위 안에서 복구한다. sourceItemIds와 sourcePages에는 제공된 값만 사용한다. 한국어로 답한다.`,
      },
      {
        role: "user",
        content: JSON.stringify(context),
      },
    ],
    text: {
      format: zodTextFormat(
        MissedFlowRecoveryDraftSchema,
        "missed_flow_recovery",
      ),
    },
  });
  if (!response.output_parsed) throw new Error("MISSED_FLOW_EMPTY_OUTPUT");
  return MissedFlowRecoveryDraftSchema.parse(response.output_parsed);
}
