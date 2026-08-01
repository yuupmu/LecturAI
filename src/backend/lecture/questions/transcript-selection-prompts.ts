import type { TranscriptSelectionIntent } from "../../schemas";

export const DEFAULT_TRANSCRIPT_SELECTION_INTENT = "explain" as const;

export const TRANSCRIPT_SELECTION_QUESTION_TEXT: Record<
  TranscriptSelectionIntent,
  { ko: string; en: string }
> = {
  explain: {
    ko: "선택한 내용을 수업의 앞뒤 맥락과 연결해 자세히 설명해 주세요.",
    en: "Explain the selected passage in detail and connect it to the surrounding lecture context.",
  },
  simplify: {
    ko: "선택한 내용을 처음 배우는 학생도 이해할 수 있도록 쉬운 말로 풀어 설명해 주세요.",
    en: "Explain the selected passage in simple language for a student learning it for the first time.",
  },
  example: {
    ko: "선택한 내용을 이해할 수 있는 구체적인 예시를 들어 설명해 주세요.",
    en: "Explain the selected passage with a concrete example.",
  },
  define_terms: {
    ko: "선택한 내용의 핵심 용어와 기호를 찾아 수업 문맥에서의 뜻을 설명해 주세요.",
    en: "Identify the key terms and symbols in the selected passage and define them in the lecture context.",
  },
};

// These instructions are sent to the LLM in addition to the visible question.
// Keeping each intent explicit prevents the four menu actions from collapsing
// into the same generic explanation response.
export const TRANSCRIPT_SELECTION_LLM_PROMPTS: Record<
  TranscriptSelectionIntent,
  string
> = {
  explain: `선택 구절의 의미를 먼저 직접 설명하라. 필요한 전제와 논리 흐름을 단계적으로 풀고, 앞뒤 수업 문맥이 이해에 실제로 도움이 될 때만 연결하라. 핵심을 생략하지 말되 선택 구절과 무관한 주제로 확장하지 마라.`,
  simplify: `선택 구절을 처음 배우는 학생에게 설명하라. 핵심 결론부터 시작하고 짧고 쉬운 문장을 사용하라. 어려운 표현은 일상적인 말로 바꾸되 반드시 필요한 전문 용어는 없애지 말고 바로 뜻을 덧붙여라. 원문의 의미와 조건을 단순화 과정에서 왜곡하거나 누락하지 마라.`,
  example: `선택 구절의 원리를 보여 주는 작고 구체적인 예시를 하나 만들어 설명하라. 예시는 제공된 수업 근거에서 확인되는 사실과 규칙 안에서만 구성하고, 가상의 설명용 예시임을 분명히 하라. 예시의 각 요소가 선택 구절의 개념에 어떻게 대응하는지 단계별로 연결하라.`,
  define_terms: `선택 구절을 이해하는 데 필요한 핵심 용어, 기호, 약어만 추려라. 각 항목에 대해 쉬운 뜻과 이 수업 문맥에서 맡는 역할을 설명한 뒤, 항목들이 선택 문장에서 어떻게 연결되는지 짧게 정리하라. 선택 구절에 없는 전문 용어를 불필요하게 추가하지 마라.`,
};

export function resolveTranscriptSelectionIntent(
  intent: TranscriptSelectionIntent | undefined,
): TranscriptSelectionIntent {
  return intent ?? DEFAULT_TRANSCRIPT_SELECTION_INTENT;
}
