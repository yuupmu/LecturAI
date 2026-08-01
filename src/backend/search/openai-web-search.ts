import { z } from "zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import {
  WebSearchSourceSchema,
  type VerificationEvent,
} from "../schemas";

// Keep the live-demo lookup bounded; there is intentionally no retry loop.
export const WEB_SEARCH_TIMEOUT_MS = 30_000;
export const WEB_SEARCH_ENABLED = false;

const SearchClaimEvidenceInputSchema = z.object({
  lectureClaim: z.string().trim().min(1),
  slideClaim: z.string().trim().min(1),
  query: z.string().trim().min(1),
  slidePage: z.number().int().positive().nullable(),
});

const UrlCitationSchema = z
  .object({
    type: z.literal("url_citation"),
    title: z.string(),
    url: z.string(),
    start_index: z.number().int(),
    end_index: z.number().int(),
  })
  .passthrough();

const OutputTextSchema = z
  .object({
    type: z.literal("output_text"),
    text: z.string(),
    annotations: z.array(z.unknown()),
  })
  .passthrough();

const OutputMessageSchema = z
  .object({
    type: z.literal("message"),
    content: z.array(z.unknown()),
  })
  .passthrough();

const SearchActionSourceSchema = z
  .object({
    type: z.literal("url"),
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const WebSearchCallSchema = z
  .object({
    type: z.literal("web_search_call"),
    action: z
      .object({
        type: z.string(),
        sources: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const OpenAIWebSearchResponseSchema = z
  .object({
    id: z.string().min(1),
    output: z.array(z.unknown()),
    output_text: z.string().optional(),
  })
  .passthrough();

export type WebSearchSource = VerificationEvent["sources"][number];

export interface WebSearchResult {
  answer: string;
  sources: WebSearchSource[];
  searchCalls: unknown[];
  rawResponseId: string;
}

// Parse by discriminated item types because Responses output order is not fixed.
export function parseOpenAIWebSearchResponse(
  untrustedResponse: unknown,
): WebSearchResult {
  const response = OpenAIWebSearchResponseSchema.parse(untrustedResponse);
  const answerParts: string[] = [];
  const citationSources: WebSearchSource[] = [];
  const actionSources: WebSearchSource[] = [];
  const searchCalls: unknown[] = [];

  for (const outputItem of response.output) {
    const searchCall = WebSearchCallSchema.safeParse(outputItem);
    if (searchCall.success) {
      searchCalls.push(searchCall.data);
      for (const source of searchCall.data.action.sources ?? []) {
        const parsed = SearchActionSourceSchema.safeParse(source);
        if (!parsed.success || !parsed.data.title?.trim()) continue;
        const normalized = toSource({
          title: parsed.data.title,
          url: parsed.data.url,
          description: parsed.data.description ?? "",
        });
        if (normalized) actionSources.push(normalized);
      }
      continue;
    }

    const message = OutputMessageSchema.safeParse(outputItem);
    if (!message.success) continue;
    for (const contentItem of message.data.content) {
      const outputText = OutputTextSchema.safeParse(contentItem);
      if (!outputText.success) continue;
      if (outputText.data.text.trim()) answerParts.push(outputText.data.text.trim());

      for (const annotation of outputText.data.annotations) {
        const citation = UrlCitationSchema.safeParse(annotation);
        if (!citation.success) continue;
        const normalized = toSource({
          title: citation.data.title,
          url: citation.data.url,
          description: "",
        });
        if (normalized) citationSources.push(normalized);
      }
    }
  }

  const answer = answerParts.join("\n\n") || response.output_text?.trim() || "";
  return {
    answer,
    sources: deduplicateSources([...citationSources, ...actionSources]).slice(0, 3),
    searchCalls,
    rawResponseId: response.id,
  };
}

// Make one mandatory OpenAI web-search call and retain only returned citations.
export async function searchClaimEvidence(
  untrustedInput: z.input<typeof SearchClaimEvidenceInputSchema>,
): Promise<WebSearchResult> {
  if (!WEB_SEARCH_ENABLED) {
    throw new Error("WEB_SEARCH_DISABLED_PHASE_1");
  }
  const input = SearchClaimEvidenceInputSchema.parse(untrustedInput);
  const env = getEnv();
  const selectedModel = env.OPENAI_SEARCH_MODEL ?? env.OPENAI_FAST_MODEL;

  try {
    const response = await getOpenAIClient().responses.create(
      {
        model: selectedModel,
        tools: [{ type: "web_search", search_context_size: "low" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: buildVerificationPrompt(input),
      },
      { signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS) },
    );
    const result = parseOpenAIWebSearchResponse(response);
    if (result.searchCalls.length === 0) {
      throw new Error("OPENAI_WEB_SEARCH_NOT_EXECUTED");
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenAI web_search failed for model ${selectedModel}: ${detail}`,
      { cause: error },
    );
  }
}

function buildVerificationPrompt(
  input: z.infer<typeof SearchClaimEvidenceInputSchema>,
): string {
  return `당신은 실시간 수업에서 강의 발화와 슬라이드 자료 사이의 사실 불일치를 검증하는 검색 에이전트다.

강의 발화:
${input.lectureClaim}

슬라이드 주장:
${input.slideClaim}

현재 슬라이드 번호:
${input.slidePage ?? "자료 없음"}

검색 쿼리:
${input.query}

웹 검색을 반드시 수행해 신뢰할 수 있는 근거를 찾아라.

규칙:
1. 현재 웹 검색 결과에서 확인할 수 있는 내용만 사용한다.
2. 강의 발화와 슬라이드 주장 중 어느 쪽을 근거가 더 지지하는지 판단할 수 있도록 설명한다.
3. 교수가 틀렸다고 공격적으로 단정하지 않는다.
4. "자료와 발화가 서로 다릅니다", "일반적으로 확인되는 근거는 다음 설명을 지지합니다", "특정 조건에서는 다르게 설명될 수 있습니다", "현재 근거만으로는 확정하기 어렵습니다" 같은 중립적인 표현을 사용한다.
5. 광고성 페이지, 검색 결과 모음 페이지, 출처가 불명확한 페이지를 핵심 근거로 삼지 않는다.
6. 공식 문서, 대학, 학술기관, 표준 문서, 신뢰도 높은 교육 자료를 우선한다.
7. 근거가 서로 충돌하면 그 사실을 숨기지 않는다.
8. 근거가 부족하면 부족하다고 말한다.
9. 학생이 빠르게 읽을 수 있도록 한국어 2~4문장으로 작성한다.
10. 출처 URL을 직접 창작하지 않는다.`;
}

function toSource(input: {
  title: string;
  url: string;
  description: string;
}): WebSearchSource | null {
  const title = input.title.trim();
  if (!title) return null;

  try {
    const parsedUrl = new URL(input.url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return WebSearchSourceSchema.parse({
      title,
      url: parsedUrl.toString(),
      hostname: parsedUrl.hostname || undefined,
      description: input.description,
    });
  } catch {
    return null;
  }
}

function deduplicateSources(sources: WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
