"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  LectureQuestionDto,
  ProfessorStyleProfileDto,
} from "@/frontend/types";
import { LectureQuestionMessage } from "./LectureQuestionMessage";
import styles from "./LectureSupport.module.css";

export function LectureQuestionDock({
  questions,
  professorStyle,
  disabled,
  onQuestion,
  openRequestId,
}: {
  questions: LectureQuestionDto[];
  professorStyle: ProfessorStyleProfileDto | null;
  disabled: boolean;
  onQuestion: (question: string) => Promise<void>;
  openRequestId?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<{
    text: string;
    previousCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastQuestionStatus = questions.at(-1)?.status;
  const visiblePendingQuestion = pendingQuestion &&
      questions.length <= pendingQuestion.previousCount
    ? pendingQuestion
    : null;
  const open = manuallyOpen || Boolean(
    openRequestId && openRequestId !== dismissedRequestId,
  );

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, questions.length, lastQuestionStatus]);

  const submit = async (value = draft) => {
    const question = value.trim();
    if (!question || submitting || disabled) return;
    setSubmitting(true);
    setPendingQuestion({ text: question, previousCount: questions.length });
    setManuallyOpen(true);
    setError(null);
    try {
      await onQuestion(question);
      setDraft("");
      setManuallyOpen(true);
    } catch (submitError) {
      setPendingQuestion(null);
      setError(submitError instanceof Error ? submitError.message : "질문을 보내지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDrawer = () => {
    setManuallyOpen((value) => !value);
    setDismissedRequestId(null);
  };

  const closeDrawer = () => {
    setManuallyOpen(false);
    setDismissedRequestId(openRequestId ?? null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className={styles.questionDock} aria-label="수업 내용 질문하기">
      <div className={styles.questionInput}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="현재까지의 수업 내용에 대해 질문하기…"
          maxLength={4_000}
          disabled={disabled}
          aria-label="수업 질문"
        />
        <button type="button" onClick={() => void submit()} disabled={disabled || submitting || !draft.trim()}>
          {submitting ? "전송 중" : "질문"}
        </button>
        <button className={styles.historyButton} type="button" onClick={toggleDrawer}>
          기록 {questions.length}
        </button>
      </div>
      {error && <p className={styles.supportError} role="alert">{error}</p>}
      {open && (
        <aside className={styles.questionDrawer} aria-label="질문과 답변 기록">
          <header>
            <div>
              <strong>LECTURE Q&amp;A</strong>
              <span>{professorStyle ? `설명 스타일 REV ${professorStyle.revision}` : "중립 설명 스타일"}</span>
            </div>
            <button type="button" onClick={closeDrawer} aria-label="질문 기록 닫기">×</button>
          </header>
          <div ref={listRef} className={styles.questionList}>
            {visiblePendingQuestion && (
              <article className={styles.questionPending} role="status" aria-live="assertive">
                <span><i aria-hidden="true" /> AI가 분석하고 있어요</span>
                <strong>{visiblePendingQuestion.text}</strong>
                <p>질문 화면을 먼저 열었습니다. 수업 자료와 지금까지의 대본을 검토한 답변이 이곳에 표시됩니다.</p>
              </article>
            )}
            {questions.length === 0 && !visiblePendingQuestion ? (
              <p className={styles.emptySupport}>PPT/PDF와 질문 시점까지의 수업 대본만으로 답합니다.</p>
            ) : questions.map((question) => (
              <LectureQuestionMessage
                key={question.id}
                question={question}
                onRetry={(target) => void submit(target.question)}
              />
            ))}
          </div>
        </aside>
      )}
    </section>
  );
}
