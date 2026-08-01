"use client";

import { useEffect, useRef, useState } from "react";
import type { MissedFlowRequestDto } from "@/frontend/types";
import styles from "./LectureSupport.module.css";

export function MissedFlowControl({
  requests,
  disabled,
  onRequest,
}: {
  requests: MissedFlowRequestDto[];
  disabled: boolean;
  onRequest: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef(new Set<string>());
  const active = [...requests].reverse().find(
    (request) => request.status === "capturing" || request.status === "generating",
  ) ?? null;

  useEffect(() => {
    const completed = [...requests].reverse().find(
      (request) => request.status === "completed" && request.recovery,
    );
    if (!completed || shownRef.current.has(completed.id)) return;
    shownRef.current.add(completed.id);
    setSelectedId(completed.id);
    setInteractionOpen(true);
  }, [requests]);

  const submit = async () => {
    if (busy || active || disabled) return;
    setBusy(true);
    setSelectedId(null);
    setInteractionOpen(true);
    setError(null);
    try {
      await onRequest();
    } catch (requestError) {
      setInteractionOpen(false);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "놓친 흐름 복구를 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const selected = requests.find((request) => request.id === selectedId) ?? null;
  const latestCompleted = [...requests].reverse().find(
    (request) => request.status === "completed" && request.recovery,
  ) ?? null;

  return (
    <section className={styles.missedFlowControl}>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || Boolean(active) || disabled}
      >
        <span aria-hidden="true">↩</span>
        {busy
          ? "기억하는 중…"
          : active?.status === "capturing"
            ? "이어지는 설명 듣는 중…"
            : active
              ? "흐름 복구 중…"
              : "방금부터 놓쳤어요"}
      </button>
      <div>
        <strong>질문 없이 바로 복구</strong>
        <span>누른 지점의 앞뒤 흐름을 AI가 이어드립니다.</span>
      </div>
      {latestCompleted && (
        <button
          className={styles.missedFlowLatest}
          type="button"
          onClick={() => setSelectedId(latestCompleted.id)}
        >
          최근 복구
        </button>
      )}
      {error && <p className={styles.supportError}>{error}</p>}
      <MissedFlowCard
        request={selected}
        pending={interactionOpen && !selected?.recovery}
        onClose={() => {
          setSelectedId(null);
          setInteractionOpen(false);
        }}
      />
    </section>
  );
}

function MissedFlowCard({
  request,
  pending,
  onClose,
}: {
  request: MissedFlowRequestDto | null;
  pending: boolean;
  onClose: () => void;
}) {
  if (!request?.recovery && !pending) return null;
  if (pending && !request?.recovery) {
    return (
      <aside
        className={styles.missedFlowCard}
        aria-label="방금 놓친 흐름 분석 중"
        aria-live="assertive"
      >
        <header>
          <div>
            <span>FLOW RECOVERY · INTERACTION STARTED</span>
            <h2>AI가 분석하고 있어요</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="복구 카드 닫기">×</button>
        </header>
        <div className={styles.flowPendingBody}>
          <div aria-hidden="true"><i /><i /><i /></div>
          <strong>상호작용 화면을 먼저 열었습니다.</strong>
          <p>누른 지점 앞뒤의 대본을 모아 흐름을 연결하고 있습니다. 결과는 이 화면에 바로 이어서 표시됩니다.</p>
        </div>
      </aside>
    );
  }
  if (!request?.recovery) return null;
  const recovery = request.recovery;

  return (
    <aside
      className={styles.missedFlowCard}
      aria-label="방금 놓친 흐름"
      aria-live="polite"
    >
      <header>
        <div>
          <span>FLOW RECOVERY</span>
          <h2>방금 놓친 흐름</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="복구 카드 닫기">×</button>
      </header>
      {recovery.fallback && (
        <p className={styles.fallbackBadge}>대본·필기 기반 복구</p>
      )}
      <ol>
        <li>
          <strong>앞에서 무엇을 설명했는지</strong>
          <p>{recovery.whatCameBefore}</p>
        </li>
        <li>
          <strong>지금 문장이 왜 나왔는지</strong>
          <p>{recovery.whyThisCameNext}</p>
        </li>
        <li>
          <strong>반드시 알아야 하는 것</strong>
          <p>{recovery.requiredIdea}</p>
        </li>
      </ol>
      <section>
        <span>지금부터는</span>
        <p>{recovery.resumeWith}</p>
      </section>
    </aside>
  );
}
