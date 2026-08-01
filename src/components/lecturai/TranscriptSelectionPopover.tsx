"use client";

import type { CSSProperties } from "react";
import type {
  TranslationTargetLanguageDto,
} from "@/frontend/types";
import styles from "./LectureAssistant.module.css";

export function TranscriptSelectionPopover({
  top,
  left,
  busy,
  error,
  selectionKind,
  targetLanguage,
  pendingAction,
  onImmediate,
}: {
  top: number;
  left: number;
  busy: boolean;
  error: string | null;
  selectionKind: "original" | "translation";
  targetLanguage: TranslationTargetLanguageDto | null;
  pendingAction: "immediate" | null;
  onImmediate: (anchor: { top: number; left: number }) => void;
}) {
  const position = { top, left } satisfies CSSProperties;
  return (
    <div
      className={styles.selectionPopover}
      style={position}
      role="dialog"
      aria-label={selectionKind === "translation" ? "선택한 번역문 도움말" : "선택한 대본 도움말"}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p>
        {selectionKind === "translation"
          ? `선택한 ${targetLanguage === "en" ? "영어" : "한국어"} 번역문을 어떻게 도와드릴까요?`
          : "선택한 내용을 어떻게 도와드릴까요?"}
      </p>
      <div className={styles.selectionActions}>
        <button
          type="button"
          disabled={busy}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onImmediate({ top: rect.bottom + 8, left: rect.left });
          }}
        >
          {busy && pendingAction === "immediate" ? "여는 중…" : "지금 물어보기"}
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
