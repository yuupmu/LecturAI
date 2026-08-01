import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  UnderstandingRejoinDraftSchema,
  type LectureNote,
  type MaterialKnowledge,
  type Transcript,
  type UnderstandingBranchMessage,
  type UnderstandingRejoinDraft,
} from "../../schemas";

export interface UnderstandingRejoinContext {
  branchId: string;
  focusText: string;
  startedAt: string;
  endedAt: string;
  startedAtSequence: number;
  endedAtSequence: number;
  fullTranscript: Transcript[];
  elapsedTurns: Transcript[];
  branchMessages: UnderstandingBranchMessage[];
  materialKnowledge: MaterialKnowledge | null;
  currentNote: LectureNote | null;
  knownCurrentLecturePosition: string;
}

export type UnderstandingRejoinComposer = (
  context: UnderstandingRejoinContext,
) => Promise<UnderstandingRejoinDraft>;

export async function generateUnderstandingRejoinPacket(
  context: UnderstandingRejoinContext,
): Promise<UnderstandingRejoinDraft> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `너는 개인 보충 설명에서 실제 수업으로 돌아오는 학생을 위한 합류 패킷을 만든다.

전체 누적 대본, 수업 자료, 현재 필기, 분기 대화가 제공된다. elapsedTurns는 분기 시작 sequence보다 크고 합류 sequence 이하인 실제 수업 구간이다.

합류 결과를 두 계층으로 작성하라.

Quick Rejoin은 학생이 10초 이내에 읽고 현재 진행 중인 수업에 즉시 돌아가기 위한 정보다. 분기 중 있었던 모든 내용을 요약하지 말고 현재 강의를 따라가기 위해 반드시 필요한 내용만 선택한다.
- mustKnowNow: 독립적으로 이해되는 짧은 문장, 최대 3개
- currentTopic: 합류 순간 교수자가 설명 중인 주제
- bridgeSentence: 개인 설명과 현재 수업을 잇는 짧고 구체적인 한 문장
- listenForNext: 지금부터 집중해서 들을 내용 한 가지

Detailed Catch-up에는 branchSummary로 개인 보충 설명에서 확인한 내용, missedLectureSummary로 분기 중 실제 수업에서 지나간 내용, keyPoints로 중요한 예시와 부가 설명을 정리한다. 긴 배경 설명과 반복은 피한다.

문장은 짧고 독립적으로 이해 가능해야 하며 “이것”, “앞의 내용”, “그 부분” 같은 모호한 표현을 피한다. elapsedTurns가 비어 있으면 새 발화가 없었다고 솔직히 말하고 알려진 최신 수업 위치를 중심으로 안내한다. 교수의 실제 발화와 AI의 일반 지식을 혼동하거나 근거 없는 내용을 추가하지 않는다. 외부 검색, 웹 검색, File Search, Vector Store를 사용하지 않는다. sourceItemIds에는 elapsedTurns에 실제 존재하는 itemId만 넣는다.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          branch: {
            focusText: context.focusText,
            startedAt: context.startedAt,
            endedAt: context.endedAt,
            startedAtSequence: context.startedAtSequence,
            endedAtSequence: context.endedAtSequence,
          },
          materialKnowledge: context.materialKnowledge,
          currentNote: context.currentNote,
          fullLectureTranscript: context.fullTranscript,
          elapsedTurns: context.elapsedTurns,
          branchConversation: context.branchMessages,
          knownCurrentLecturePosition: context.knownCurrentLecturePosition,
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        UnderstandingRejoinDraftSchema,
        "understanding_rejoin_packet",
      ),
    },
  });
  if (!response.output_parsed) {
    throw new Error("UNDERSTANDING_REJOIN_EMPTY_OUTPUT");
  }
  return UnderstandingRejoinDraftSchema.parse(response.output_parsed);
}
