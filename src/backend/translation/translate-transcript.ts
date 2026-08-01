import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import type { TranslationTargetLanguage } from "../schemas";
import {
  buildTranslationPrompt,
  TRANSLATION_SYSTEM_PROMPT,
} from "./translation-prompt";

export const TRANSLATION_TIMEOUT_MS = 3_000;

export interface TranslateTranscriptInput {
  text: string;
  targetLanguage: TranslationTargetLanguage;
  currentSlide: {
    title: string;
    keyConcepts: string[];
    keywords: string[];
  } | null;
  recentContext: Array<{ sequence: number; text: string }>;
  previousTranslations: Array<{
    sourceText: string;
    translatedText: string;
  }>;
}

export async function translateTranscript(
  input: TranslateTranscriptInput,
): Promise<{ translatedText: string }> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TRANSLATION_TIMEOUT_MS,
  );
  timeout.unref?.();
  try {
    const response = await getOpenAIClient().responses.create(
      {
        model: env.OPENAI_TRANSLATION_MODEL,
        input: [
          { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
          { role: "user", content: buildTranslationPrompt(input) },
        ],
        max_output_tokens: 240,
      },
      { signal: controller.signal },
    );
    const translatedText = cleanTranslationOutput(response.output_text ?? "");
    if (!translatedText) throw new Error("TRANSLATION_EMPTY_OUTPUT");
    return { translatedText };
  } finally {
    clearTimeout(timeout);
  }
}

export function cleanTranslationOutput(value: string): string {
  let output = value.trim();
  const fenced = output.match(/^```(?:text)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) output = fenced[1].trim();
  output = output.replace(
    /^(?:translated\s*text|translation|번역(?:문|문장)?)\s*:\s*/iu,
    "",
  ).trim();
  const wrapped = output.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u);
  return (wrapped?.[1] ?? wrapped?.[2] ?? output).trim();
}
