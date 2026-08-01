"use client";

import { useEffect, useMemo, useState } from "react";
import type { NoteGenerationStateDto } from "@/frontend/types";
import styles from "./LectureNotebook.module.css";

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatClock(value: string | null): string {
  if (!value) return "아직 생성 전";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function NoteGenerationControls({
  state,
  sessionEnded,
  hasNewTranscript,
}: {
  state: NoteGenerationStateDto;
  sessionEnded: boolean;
  hasNewTranscript: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const active = state.status === "queued" ||
    state.status === "generating" || state.status === "reviewing";
  const intervalLabel = state.intervalSeconds % 60 === 0
    ? `${state.intervalSeconds / 60}분`
    : `${state.intervalSeconds}초`;
  const countdown = useMemo(() => {
    if (sessionEnded) return "수업 종료됨";
    if (active) return "필기 생성 중";
    if (!state.nextScheduledAt) return "다음 예약 전";
    return formatCountdown(new Date(state.nextScheduledAt).getTime() - now);
  }, [active, now, sessionEnded, state.nextScheduledAt]);

  return (
    <div className={styles.noteControls}>
      <div className={styles.automaticNoteStatus}>
        <span aria-hidden="true" />
        {intervalLabel}마다 자동 필기
      </div>
      <dl className={styles.noteTiming}>
        <div>
          <dt>마지막 필기</dt>
          <dd>{formatClock(state.lastGeneratedAt)}</dd>
        </div>
        <div>
          <dt>다음 자동 필기까지</dt>
          <dd>{countdown}</dd>
        </div>
      </dl>
      <div className={styles.noteRange}>
        <span>
          누적 반영 · SEQ {state.lastProcessedSequence > 0
            ? `1–${state.lastProcessedSequence}`
            : "—"}
        </span>
        <strong>{hasNewTranscript ? "새 대본 있음" : "모두 반영됨"}</strong>
      </div>
      {state.status === "failed" && (
        <p className={styles.noteError} role="alert">
          필기 생성에 실패했습니다. 원본 대본은 보존되어 있습니다.
        </p>
      )}
    </div>
  );
}
