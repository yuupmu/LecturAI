"use client";

import type { AbsenceSpanDto } from "@/frontend/types";
import styles from "./LectureSupport.module.css";

export function AbsenceCatchupModal({
  span,
  onClose,
}: {
  span: AbsenceSpanDto | null;
  onClose: () => void;
}) {
  if (!span?.summary) return null;
  const summary = span.summary;
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <article className={styles.absenceModal} role="dialog" aria-modal="true" aria-label="자리 비운 동안의 강의" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>ABSENCE CATCH-UP</span>
            <h2>자리 비운 동안의 강의</h2>
            <time>{formatRange(span.startedAt, span.endedAt)}</time>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className={styles.absenceModalBody}>
          {summary.fallback && <p className={styles.fallbackBadge}>원본 기록 기반 fallback 요약</p>}
          <section>
            <h3>한눈에 보기</h3>
            <p>{summary.overview}</p>
          </section>
          {summary.detailedSections.map((section, index) => (
            <section key={`${span.id}-section-${index}`}>
              <h3>{index + 1}. {section.title}</h3>
              <p>{section.explanation}</p>
              {section.keyPoints.length > 0 && <ul>{section.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
            </section>
          ))}
          <section>
            <h3>중요 포인트</h3>
            {summary.importantPoints.length > 0
              ? <ul>{summary.importantPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              : <p>별도로 표시된 중요 포인트가 없습니다.</p>}
          </section>
          <section>
            <h3>현재 수업 위치</h3>
            <p>{summary.currentLecturePosition}</p>
          </section>
          {summary.suggestedReviewQuestions.length > 0 && (
            <section>
              <h3>복습 질문</h3>
              <ol>{summary.suggestedReviewQuestions.map((question) => <li key={question}>{question}</li>)}</ol>
            </section>
          )}
          <details className={styles.absenceSources}>
            <summary>관련 근거 보기</summary>
            <p>필기: {summary.sourceNoteIds.join(", ") || "없음"}</p>
            <p>대본: {summary.sourceItemIds.join(", ") || "없음"}</p>
            <p>자료 페이지: {summary.sourcePages.join(", ") || "없음"}</p>
          </details>
        </div>
      </article>
    </div>
  );
}

function formatRange(start: string, end: string | null): string {
  const formatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${formatter.format(new Date(start))} – ${end ? formatter.format(new Date(end)) : "진행 중"}`;
}
