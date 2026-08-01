import type { LectureAssistantQuestionDto } from "@/frontend/types";
import styles from "./LectureAssistant.module.css";

export function LectureAssistantMessage({
  request,
  onRetry,
  onOpenSelection,
}: {
  request: LectureAssistantQuestionDto;
  onRetry?: (request: LectureAssistantQuestionDto) => void;
  onOpenSelection?: (request: LectureAssistantQuestionDto) => void;
}) {
  return (
    <article className={styles.assistantMessage}>
      <header>
        <span className={styles.modeLabel}>
          {request.mode === "question" ? "QUESTION" : "SELECTION EXPLANATION"}
          {` · SNAPSHOT #${request.snapshotSequence}`}
        </span>
        <span className={styles.statusLabel}>{statusLabel(request.status)}</span>
      </header>

      {request.selection ? (
        <blockquote className={styles.selectionQuote}>
          “{request.selection.selectedText}”
        </blockquote>
      ) : (
        <p className={styles.questionText}>{request.question}</p>
      )}

      {(request.status === "queued" || request.status === "answering") && (
        <p className={styles.loadingAnswer}>
          {request.status === "queued" ? "답변 순서를 기다리고 있습니다." : "수업 전체 문맥으로 답변하고 있습니다."}
        </p>
      )}

      {request.status === "failed" && (
        <div>
          <p className={styles.failedAnswer}>
            {request.errorMessage ?? "답변을 생성하지 못했습니다."}
          </p>
          {onRetry && (
            <button
              className={styles.retryButton}
              type="button"
              onClick={() => onRetry(request)}
            >
              다시 시도
            </button>
          )}
        </div>
      )}

      {request.answer && (
        <div className={styles.answerBody}>
          <h3>{request.answer.title}</h3>
          <p className={styles.directAnswer}>{request.answer.directAnswer}</p>
          <p className={styles.explanation}>{request.answer.explanation}</p>
          {request.answer.keyPoints.length > 0 && (
            <ul>
              {request.answer.keyPoints.map((point, index) => (
                <li key={`${request.id}-point-${index}`}>{point}</li>
              ))}
            </ul>
          )}
          {request.answer.example && (
            <div className={styles.example}>
              <strong>EXAMPLE</strong>
              <p>{request.answer.example}</p>
            </div>
          )}
          <footer className={styles.answerFooter}>
            <span className={styles.basisBadge}>
              {basisLabel(request.answer.basis)}
            </span>
            {request.selection && onOpenSelection && (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => onOpenSelection(request)}
              >
                크게 보기
              </button>
            )}
          </footer>
        </div>
      )}
    </article>
  );
}

function statusLabel(status: LectureAssistantQuestionDto["status"]): string {
  if (status === "queued") return "QUEUED";
  if (status === "answering") return "ANSWERING";
  if (status === "answered") return "ANSWERED";
  return "FAILED";
}

function basisLabel(
  basis: NonNullable<LectureAssistantQuestionDto["answer"]>["basis"],
): string {
  if (basis === "lecture_only") return "수업 내용 기반";
  if (basis === "lecture_plus_general_knowledge") {
    return "수업 내용 + 추가 설명";
  }
  return "일반 지식 기반";
}
