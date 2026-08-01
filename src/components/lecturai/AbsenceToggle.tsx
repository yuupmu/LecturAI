"use client";

import { useEffect, useRef, useState } from "react";
import type { AbsenceSpanDto } from "@/frontend/types";
import { AbsenceCatchupModal } from "./AbsenceCatchupModal";
import styles from "./LectureSupport.module.css";

export function AbsenceToggle({
  spans,
  disabled,
  onStart,
  onEnd,
}: {
  spans: AbsenceSpanDto[];
  disabled: boolean;
  onStart: () => Promise<void>;
  onEnd: () => Promise<void>;
}) {
  const active = spans.find((span) => span.status === "active") ?? null;
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    const completed = [...spans].reverse().find((span) => span.status === "completed" && span.summary);
    if (!completed || notifiedRef.current.has(completed.id)) return;
    notifiedRef.current.add(completed.id);
    setSelectedId(completed.id);
  }, [spans]);

  const toggle = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      if (active) await onEnd();
      else await onStart();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "자리 비움 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  const selected = spans.find((span) => span.id === selectedId) ?? null;

  return (
    <section className={`${styles.absenceControl} ${active ? styles.absenceActive : ""}`}>
      <button type="button" onClick={() => void toggle()} disabled={busy || disabled}>
        {busy ? "처리 중…" : active ? "수업으로 돌아왔어요" : "잠시 자리 비우기"}
      </button>
      <div>
        <strong>{active ? "부재 기록 중" : "부재 모드"}</strong>
        <span>{active ? "부재 중에도 수업 기록과 필기는 계속됩니다." : "돌아오면 놓친 구간을 상세히 정리합니다."}</span>
      </div>
      <button className={styles.absenceHistoryButton} type="button" onClick={() => setHistoryOpen((value) => !value)}>
        기록 {spans.length}
      </button>
      {error && <p className={styles.supportError}>{error}</p>}
      {historyOpen && (
        <div className={styles.absenceHistory}>
          {spans.length === 0 ? <p>아직 자리 비움 기록이 없습니다.</p> : [...spans].reverse().map((span, index) => (
            <button key={span.id} type="button" disabled={!span.summary} onClick={() => setSelectedId(span.id)}>
              <span>부재 {spans.length - index}</span>
              <small>{span.status === "summarizing" ? "요약 중" : span.status === "active" ? "진행 중" : span.summary ? "요약 보기" : "실패"}</small>
            </button>
          ))}
        </div>
      )}
      <AbsenceCatchupModal span={selected} onClose={() => setSelectedId(null)} />
    </section>
  );
}
