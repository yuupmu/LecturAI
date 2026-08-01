import type { FullLectureAssistantContext } from "./build-full-lecture-context";

export const EXPLAIN_TRANSCRIPT_SELECTION_PROMPT = `사용자가 수업 대본의 특정 부분을 선택했다.

선택한 부분을 현재 전체 수업 맥락에 맞게 자세히 설명하라. 선택 부분의 의미를 가장 먼저 설명하고, 전체 대본은 대명사·지시어·생략된 전제와 앞뒤 연결을 이해하기 위한 문맥으로만 사용하라. 전체 대본의 다른 주제를 중심으로 바꾸지 마라.

수업 자료와 대본을 우선 참고하되 필요한 경우 일반 지식으로 이해를 보충할 수 있다. 웹 검색이나 외부 자료 조회는 하지 마라. 교수의 발언이 아닌 내용을 교수의 발언처럼 표현하거나 교수의 말투를 사칭하지 마라.

선택한 문장의 쉬운 해석, 핵심 원리, 앞뒤 수업 내용과의 연결, 단계별 설명, 간단한 예시를 적절히 포함하라. 선택이 모호하면 가장 가능성 높은 의미를 설명하되 불확실성을 숨기지 마라.`;

export function formatSelectionContext(
  context: FullLectureAssistantContext,
): string {
  if (!context.selection) {
    throw new Error("ASSISTANT_SELECTION_MISSING");
  }
  return [
    "<highlighted_transcript>",
    context.selection.selectedText,
    "</highlighted_transcript>",
    "<highlighted_transcript_metadata>",
    JSON.stringify({
      sourceItemIds: context.selection.sourceItemIds,
      startSequence: context.selection.startSequence,
      endSequence: context.selection.endSequence,
    }),
    "</highlighted_transcript_metadata>",
  ].join("\n");
}
