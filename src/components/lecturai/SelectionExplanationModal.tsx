"use client";

import { useEffect } from "react";
import type { LectureAssistantQuestionDto } from "@/frontend/types";
import { LectureAssistantMessage } from "./LectureAssistantMessage";
import styles from "./LectureAssistant.module.css";

export function SelectionExplanationModal({
  request,
  selectedText,
  onRetry,
  onClose,
}: {
  request: LectureAssistantQuestionDto | null;
  selectedText: string;
  onRetry: (request: LectureAssistantQuestionDto) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.selectionModal} role="dialog" aria-modal="true">
        <header>
          <strong>선택한 수업 내용 · 자세한 설명</strong>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className={styles.modalBody}>
          {request ? (
            <LectureAssistantMessage request={request} onRetry={onRetry} />
          ) : (
            <article className={styles.assistantMessage}>
              <blockquote className={styles.selectionQuote}>“{selectedText}”</blockquote>
              <p className={styles.loadingAnswer}>답변 요청을 동기화하고 있습니다.</p>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
