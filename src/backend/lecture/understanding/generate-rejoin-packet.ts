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

반드시 다음을 구분해 작성하라.
1. understoodContent: 분기 대화에서 학생이 확인한 핵심
2. lectureProgress: 그사이 실제 수업에서 진행된 핵심
3. currentLecturePosition: 합류 순간 교수자가 설명하는 위치
4. connection: 개인 설명과 실제 수업을 잇는 짧고 구체적인 연결 문장
5. listenFor: 지금부터 무엇을 생각하며 들으면 되는지

elapsedTurns가 비어 있으면 새 발화가 없었다고 솔직히 말한다. 교수의 실제 발화와 AI의 일반 지식을 혼동하지 않는다. 외부 검색, 웹 검색, File Search, Vector Store를 사용하지 않는다. sourceItemIds에는 elapsedTurns에 실제 존재하는 itemId만 넣는다.`,
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
