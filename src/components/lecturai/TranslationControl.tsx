"use client";

import type {
  TranslationSettingsDto,
  TranslationTargetLanguageDto,
} from "@/frontend/types";
import styles from "./TranslationControl.module.css";

export function TranslationControl({
  settings,
  busy,
  feedback,
  disabled = false,
  onChange,
}: {
  settings: TranslationSettingsDto;
  busy: boolean;
  feedback: string | null;
  disabled?: boolean;
  onChange: (language: TranslationTargetLanguageDto | null) => void;
}) {
  const value = settings.enabled && settings.targetLanguage
    ? settings.targetLanguage
    : "off";

  return (
    <div className={styles.control}>
      <label htmlFor="live-translation-language">TRANSLATION</label>
      <select
        id="live-translation-language"
        value={value}
        disabled={busy || disabled}
        aria-describedby="live-translation-status"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "ko" || next === "en" ? next : null);
        }}
      >
        <option value="off">꺼짐</option>
        <option value="ko">한국어</option>
        <option value="en">English</option>
      </select>
      {(busy || feedback) && (
        <span id="live-translation-status" role="status" aria-live="polite">
          {busy ? "번역 설정을 바꾸고 있습니다." : feedback}
        </span>
      )}
    </div>
  );
}
