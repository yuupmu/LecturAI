import { z } from "zod";
import {
  TranslationSettingsSchema,
  TranslationTargetLanguageSchema,
  type LectureSession,
  type TranslationSettings,
} from "../schemas";
import { touchSession } from "../session-store";

export const TranslationSettingsInputSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: TranslationTargetLanguageSchema.nullable(),
}).superRefine((input, context) => {
  if (input.enabled && input.targetLanguage === null) {
    context.addIssue({
      code: "custom",
      path: ["targetLanguage"],
      message: "An enabled translation needs a target language",
    });
  }
});

export function createTranslationSettings(
  revision = 0,
): TranslationSettings {
  return TranslationSettingsSchema.parse({
    enabled: false,
    targetLanguage: null,
    revision,
    updatedAt: Date.now(),
  });
}

export function updateTranslationSettings(
  session: LectureSession,
  input: z.infer<typeof TranslationSettingsInputSchema>,
): TranslationSettings {
  const parsed = TranslationSettingsInputSchema.parse(input);
  session.translationSettings = TranslationSettingsSchema.parse({
    enabled: parsed.enabled,
    targetLanguage: parsed.enabled ? parsed.targetLanguage : null,
    revision: session.translationSettings.revision + 1,
    updatedAt: Date.now(),
  });
  session.translations = [];
  session.processedTranslationKeys = new Set<string>();
  // A stale request may still finish, but revision checks prevent it from
  // publishing. A fresh chain lets the new language start immediately.
  session.translationChain = Promise.resolve();
  touchSession(session);
  return session.translationSettings;
}
