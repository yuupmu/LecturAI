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
  onDefer,
}: {
  top: number;
  left: number;
  busy: boolean;
  error: string | null;
  selectionKind: "original" | "translation";
  targetLanguage: TranslationTargetLanguageDto | null;
  pendingAction: "immediate" | "defer" | null;
  onImmediate: () => void;
  onDefer: () => void;
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={onImmediate}
        >
          {busy && pendingAction === "immediate" ? "여는 중…" : "지금 자세히 이해하기"}
        </button>
        <button
          type="button"
          disabled={busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDefer}
        >
          {busy && pendingAction === "defer" ? "맡기는 중…" : "질문만 맡겨두기"}
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
