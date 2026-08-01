import { getEnv } from "../env";
import {
  RealtimeClientSecretResponseSchema,
  type SlideMap,
} from "../schemas";
import { z } from "zod";

const RealtimeApiErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.union([z.string(), z.number()]).nullable().optional(),
    param: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

const RealtimeKeywordSchema = z.string().regex(
  /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u,
);

// Realtime keyword hints accept words and spaces, not formula punctuation.
export function buildTranscriptionKeywords(slideMap: SlideMap): string[] {
  const candidates = [
    ...slideMap.globalKeywords,
    ...slideMap.slides.flatMap((slide) => [
      ...slide.keywords,
      ...slide.keyConcepts,
    ]),
  ];

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const parsed = RealtimeKeywordSchema.safeParse(normalized);
    if (!parsed.success) continue;

    const deduplicationKey = parsed.data.toLocaleLowerCase();
    if (seen.has(deduplicationKey)) continue;
    seen.add(deduplicationKey);
    keywords.push(parsed.data);
    if (keywords.length === 40) break;
  }
  return keywords;
}

// Creates only an ephemeral client secret; the server API key never crosses the route.
export async function createTranscriptionToken(slideMap: SlideMap) {
  const keywords = buildTranscriptionKeywords(slideMap);

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getEnv().OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: {
                model: "gpt-live-transcribe",
                languages: ["ko", "en"],
                delay: "low",
                prompt: `${slideMap.documentTitle}\n${slideMap.documentSummary}`,
                ...(keywords.length > 0 ? { keywords } : {}),
              },
            },
          },
        },
      }),
    },
  );

  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsedError = RealtimeApiErrorSchema.safeParse(payload);
    const detail = parsedError.success
      ? [
          parsedError.data.error.code,
          parsedError.data.error.param,
          parsedError.data.error.message,
        ].filter((value) => value !== null && value !== undefined && value !== "")
          .join(" · ")
      : "OpenAI가 구조화되지 않은 오류 응답을 반환했습니다.";
    throw new Error(`REALTIME_TOKEN_FAILED_${response.status}: ${detail}`);
  }
  return RealtimeClientSecretResponseSchema.parse(payload);
}
