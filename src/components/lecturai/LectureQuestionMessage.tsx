import type {
  LectureQuestionDto,
  TranscriptSelectionIntentDto,
} from "@/frontend/types";
import styles from "./LectureSupport.module.css";

export function LectureQuestionMessage({
  question,
  onRetry,
  loadingText,
}: {
  question: LectureQuestionDto;
  onRetry: (question: LectureQuestionDto) => void;
  loadingText?: string;
}) {
  return (
    <article className={styles.questionMessage}>
      <header>
        <span>
          {question.selection ? "SELECTED PASSAGE" : "Q"} · REV {question.lectureRevision}
          {question.answerLanguage ? ` · ${question.answerLanguage.toUpperCase()}` : ""}
        </span>
        <small>{statusLabel(question.status)}</small>
      </header>
      {question.selection ? (
        <div className={styles.selectedPassage}>
          <small>
            {question.selection.kind === "translation"
              ? `선택한 번역문 · ${question.selection.targetLanguage === "en" ? "ENGLISH" : "한국어"}`
              : "선택한 원문 대본"}
            {` · ${selectionIntentLabel(question.selection.intent)}`}
          </small>
          <blockquote>“{question.selection.selectedText}”</blockquote>
        </div>
      ) : (
        <p className={styles.askedQuestion}>{question.question}</p>
      )}
      {(question.status === "queued" || question.status === "answering") && (
        <p className={styles.answering}>
          {loadingText ?? (
            question.status === "queued"
              ? "답변 순서를 기다리고 있습니다."
              : "수업 내부 근거를 검토하고 있습니다."
          )}
        </p>
      )}
      {question.status === "insufficient_context" && (
        <div className={styles.insufficient}>
          <p>{question.errorMessage}</p>
          <button type="button" onClick={() => onRetry(question)}>현재 내용으로 다시 질문</button>
        </div>
      )}
      {question.status === "failed" && (
        <div className={styles.failedQuestion}>
          <p>{question.errorMessage ?? "답변 생성에 실패했습니다."}</p>
          <button type="button" onClick={() => onRetry(question)}>다시 시도</button>
        </div>
      )}
      {question.answer && (
        <div className={styles.answerBody}>
          <strong>{question.answer.shortAnswer}</strong>
          <p>{question.answer.text}</p>
          {question.answer.keyPoints.length > 0 && (
            <ul>
              {question.answer.keyPoints.map((point, index) => (
                <li key={`${question.id}-point-${index}`}>{point}</li>
              ))}
            </ul>
          )}
          <small className={styles.aiStyleNotice}>
            {question.answer.styleProfileRevision
              ? `현재 수업의 설명 방식을 반영한 AI 답변 · STYLE ${question.answer.styleProfileRevision}`
              : "현재 수업 자료에 근거한 중립적 AI 답변"}
          </small>
          <details className={styles.evidenceList}>
            <summary>근거 {question.answer.evidence.length}개 보기</summary>
            {question.answer.evidence.map((evidence, index) => (
              <article key={`${question.id}-evidence-${index}`}>
                <strong>{evidence.label}</strong>
                <p>{evidence.excerpt}</p>
                <small>
                  {evidence.sourcePage ? `PAGE ${evidence.sourcePage}` : ""}
                  {evidence.sourceItemIds.length > 0
                    ? `${evidence.sourcePage ? " · " : ""}${evidence.sourceItemIds.join(", ")}`
                    : ""}
                </small>
              </article>
            ))}
          </details>
        </div>
      )}
    </article>
  );
}

function selectionIntentLabel(
  intent: TranscriptSelectionIntentDto | undefined,
): string {
  if (intent === "simplify") return "더 쉽게";
  if (intent === "example") return "예시로";
  if (intent === "define_terms") return "용어 설명";
  return "자세히 설명";
}

function statusLabel(status: LectureQuestionDto["status"]): string {
  if (status === "queued") return "QUEUED";
  if (status === "answering") return "ANSWERING";
  if (status === "answered") return "ANSWERED";
  if (status === "insufficient_context") return "NEED MORE CONTEXT";
  return "FAILED";
}
