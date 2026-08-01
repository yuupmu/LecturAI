"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { LectureAssistantQuestionDto } from "@/frontend/types";
import { LectureAssistantMessage } from "./LectureAssistantMessage";
import assistantStyles from "./LectureAssistant.module.css";
import questionStyles from "./LectureSupport.module.css";

export function SelectionExplanationModal({
  request,
  selectedText,
  anchor,
  error,
  onRetry,
  onClose,
}: {
  request: LectureAssistantQuestionDto | null;
  selectedText: string;
  anchor: { top: number; left: number };
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState(() => popupPosition(anchor));
  const modalRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const modalRect = modalRef.current?.getBoundingClientRect();
    if (!modalRect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: position.left,
      originTop: position.top,
      minX: 12,
      maxX: Math.max(12, window.innerWidth - modalRect.width - 12),
      minY: 12,
      maxY: Math.max(12, window.innerHeight - modalRect.height - 12),
    };
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      left: clamp(
        drag.originLeft + event.clientX - drag.startX,
        drag.minX,
        drag.maxX,
      ),
      top: clamp(
        drag.originTop + event.clientY - drag.startY,
        drag.minY,
        drag.maxY,
      ),
    });
  };

  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const modal = (
    <div
      className={assistantStyles.floatingPopupLayer}
      role="presentation"
    >
      <section
        ref={modalRef}
        className={`${assistantStyles.selectionModal} ${assistantStyles.floatingSelectionPopup}`}
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-labelledby="selection-answer-title"
      >
        <header
          className={assistantStyles.draggableModalHeader}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <strong id="selection-answer-title">선택한 수업 내용 · AI 답변</strong>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className={assistantStyles.modalBody} aria-live="polite">
          {request ? (
            <LectureAssistantMessage request={request} onRetry={onRetry} />
          ) : (
            <article className={questionStyles.questionMessage}>
              <div className={questionStyles.selectedPassage}>
                <small>선택한 대본</small>
                <blockquote>“{selectedText}”</blockquote>
              </div>
              {error ? (
                <div className={questionStyles.failedQuestion} role="alert">
                  <p>{error}</p>
                  <button type="button" onClick={onRetry}>다시 시도</button>
                </div>
              ) : (
                <p className={questionStyles.answering} role="status">
                  AI가 답변을 생성하고 있어요…
                </p>
              )}
            </article>
          )}
        </div>
      </section>
    </div>
  );

  // The live workspace is an animated, overflow-hidden container. Rendering a
  // fixed dialog inside it makes the workspace the dialog's containing block
  // in browsers, so the dialog can be clipped or hidden behind sibling layers.
  return typeof document === "undefined"
    ? null
    : createPortal(modal, document.body);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function popupPosition(anchor: { top: number; left: number }): {
  top: number;
  left: number;
} {
  if (typeof window === "undefined") return anchor;
  const popupWidth = Math.min(560, window.innerWidth - 24);
  const top = anchor.top < window.innerHeight - 180
    ? anchor.top
    : Math.max(12, anchor.top - 340);
  return {
    top: clamp(top, 12, Math.max(12, window.innerHeight - 120)),
    left: clamp(anchor.left, 12, Math.max(12, window.innerWidth - popupWidth - 12)),
  };
}
