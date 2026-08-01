import type { TranslationTargetLanguage } from "../schemas";

export interface TranslationPromptInput {
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

export const TRANSLATION_SYSTEM_PROMPT = `You translate a finalized university lecture caption directly into the requested target language.

Rules:
1. Translate CURRENT_TRANSCRIPT accurately and naturally. Do not summarize, explain, complete an unfinished thought, or add information.
2. Preserve the lecturer's intent, uncertainty, negation, jokes, and tone where possible.
3. Preserve equations, code, variable and function names, filenames, URLs, and expressions such as O(log n), O(n), API, PDF, React, and TypeScript.
4. Prefer terminology from the current slide hints and prior translations, but do not alter proper nouns.
5. Use recent transcripts only to resolve ambiguous references and terminology. Translate only CURRENT_TRANSCRIPT.
6. Do not add parenthetical explanations that are absent from the source.
7. Return no heading, label, quotation wrapper, or Markdown fence.`;

export function buildTranslationPrompt(
  input: TranslationPromptInput,
): string {
  return JSON.stringify({
    TARGET_LANGUAGE: input.targetLanguage === "ko" ? "Korean" : "English",
    CURRENT_TRANSCRIPT: input.text,
    RECENT_TRANSCRIPTS: input.recentContext.slice(-2),
    CURRENT_SLIDE: input.currentSlide
      ? {
          title: input.currentSlide.title,
          keyConcepts: input.currentSlide.keyConcepts.slice(0, 8),
          keywords: input.currentSlide.keywords.slice(0, 8),
        }
      : null,
    PREVIOUS_TRANSLATIONS: input.previousTranslations.slice(-2),
  });
}
