import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  AbsenceSummaryDraftSchema,
  type AbsenceSummaryDraft,
  type Transcript,
} from "../../schemas";
import type { AbsenceSummaryContext } from "./build-absence-context";

const CHUNK_SIZE = 40;

export type AbsenceSummaryComposer = (
  context: AbsenceSummaryContext,
  revisionInstructions?: string[],
) => Promise<AbsenceSummaryDraft>;

export async function generateAbsenceSummary(
  context: AbsenceSummaryContext,
  revisionInstructions: string[] = [],
): Promise<AbsenceSummaryDraft> {
  if (context.absenceTurns.length <= CHUNK_SIZE) {
    return generateWithModel(context, context.absenceTurns, [], revisionInstructions);
  }
  const chunks = chunk(context.absenceTurns, CHUNK_SIZE);
  const partials: AbsenceSummaryDraft[] = [];
  for (const turns of chunks) {
    partials.push(await generateWithModel(context, turns, [], [
      "이 결과는 긴 부재 구간의 일부다. 이 chunk 안의 내용만 구조화하라.",
    ]));
  }
  return generateWithModel(context, [], partials, [
    "부분 요약을 중복 없이 하나의 시간순 상세 요약으로 병합하라.",
    ...revisionInstructions,
  ]);
}

async function generateWithModel(
  context: AbsenceSummaryContext,
  turns: Transcript[],
  partials: AbsenceSummaryDraft[],
  revisionInstructions: string[],
): Promise<AbsenceSummaryDraft> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `학생이 자리를 비운 구간의 따라잡기 요약을 만든다. absenceTurns 또는 partialSummaries에 실제 포함된 새 학습 내용만 결과에 넣는다. beforeContext와 afterContext는 대명사·전환 이해용이며 그 내용을 부재 중 새 내용처럼 넣지 않는다.

외부 지식과 일반 지식을 추가하지 않는다. 부재 중 정의, 조건, 과정, 공식, 예시, 명시적 강조를 구체적으로 정리하고 현재 수업 위치와 복습 질문을 제공한다. 잡담과 행정 안내는 학습 핵심으로 쓰지 않는다. 수업다운 내용이 없으면 그 사실을 솔직히 적는다. sourceItemIds는 부재 구간 itemId만, sourceNoteIds와 sourcePages는 제공된 값만 사용한다.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          span: {
            startedAt: context.startedAt,
            endedAt: context.endedAt,
            startedAtSequence: context.startedAtSequence,
            endedAtSequence: context.endedAtSequence,
          },
          beforeContext: context.beforeContext,
          absenceTurns: turns,
          afterContext: context.afterContext,
          relatedNotes: context.relatedNotes,
          materialKnowledge: context.materialKnowledge,
          knownCurrentLecturePosition: context.currentLecturePosition,
          partialSummaries: partials,
          revisionInstructions,
        }),
      },
    ],
    text: {
      format: zodTextFormat(AbsenceSummaryDraftSchema, "absence_summary"),
    },
  });
  if (!response.output_parsed) throw new Error("ABSENCE_SUMMARY_EMPTY_OUTPUT");
  return AbsenceSummaryDraftSchema.parse(response.output_parsed);
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
