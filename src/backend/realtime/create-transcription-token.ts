import { getEnv } from "../env";
import {
  RealtimeClientSecretResponseSchema,
  type SlideMap,
} from "../schemas";

// Creates only an ephemeral client secret; the server API key never crosses the route.
export async function createTranscriptionToken(slideMap: SlideMap) {
  const keywords = [
    ...slideMap.globalKeywords,
    ...slideMap.slides.flatMap((slide) => [
      ...slide.keywords,
      ...slide.keyConcepts,
    ]),
  ];
  const uniqueKeywords = Array.from(
    new Map(
      keywords
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .map((keyword) => [keyword.toLocaleLowerCase(), keyword]),
    ).values(),
  ).slice(0, 40);

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
                keywords: uniqueKeywords,
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 650,
              },
            },
          },
        },
      }),
    },
  );

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`REALTIME_TOKEN_FAILED_${response.status}`);
  }
  return RealtimeClientSecretResponseSchema.parse(payload);
}
