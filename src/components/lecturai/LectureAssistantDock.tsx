"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LectureAssistantQuestionDto } from "@/frontend/types";
import { LectureAssistantMessage } from "./LectureAssistantMessage";
import styles from "./LectureAssistant.module.css";

export function LectureAssistantDock({
  requests,
  onQuestion,
  onRetry,
  onOpenSelection,
}: {
  requests: LectureAssistantQuestionDto[];
  onQuestion: (question: string) => Promise<void>;
  onRetry: (request: LectureAssistantQuestionDto) => Promise<void>;
  onOpenSelection: (request: LectureAssistantQuestionDto) => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const latestStatus = requests.at(-1)?.status;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [latestStatus, requests.length]);

  const submit = async () => {
    const question = draft.trim();
    if (!question || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onQuestion(question);
      setDraft("");
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (request: LectureAssistantQuestionDto) => {
    setError(null);
    try {
      await onRetry(request);
    } catch (retryError) {
      setError(errorMessage(retryError));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <aside className={styles.assistantDock} aria-label="수업 질문 AI 튜터">
      <header>
        <strong>LECTURE ASSISTANT</strong>
        <span>수업 문맥 우선 · 일반 지식 보충</span>
      </header>
      <div ref={listRef} className={styles.messageList} aria-live="polite">
        {requests.length === 0 ? (
          <p className={styles.emptyAssistant}>
            수업 중 궁금한 점을 질문하거나 대본을 드래그해 자세한 설명을 받아보세요.
          </p>
        ) : requests.map((request) => (
          <LectureAssistantMessage
            key={request.id}
            request={request}
            onRetry={(target) => void retry(target)}
            onOpenSelection={onOpenSelection}
          />
        ))}
      </div>
      <form
        className={styles.questionForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="수업에 대해 질문하세요…"
          aria-label="수업 질문"
          maxLength={4_000}
        />
        <button type="submit" disabled={submitting || !draft.trim()}>
          {submitting ? "전송 중" : "질문"}
        </button>
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </form>
    </aside>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "질문을 보내지 못했습니다.";
}
