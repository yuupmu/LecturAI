"use client";

import { useEffect, useState } from "react";
import type { LectureActivityStateDto } from "@/frontend/types";
import styles from "./LectureSupport.module.css";

export function EndingCandidateBanner({
  activity,
  busy,
  onCancel,
}: {
  activity: LectureActivityStateDto;
  busy: boolean;
  onCancel: () => Promise<void>;
}) {
  const candidate = activity.endingCandidate;
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!candidate) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(candidate.expiresAt).getTime() - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [candidate]);
  if (!candidate) return null;

  return (
    <aside className={styles.endingBanner} role="alert">
      <div>
        <strong>{candidate.kind === "explicit" ? "수업 종료로 판단했습니다." : "10분 동안 새로운 강의 내용이 감지되지 않았습니다."}</strong>
        <p>{candidate.kind === "explicit" ? "잠시 후 기록을 마무리합니다." : "카운트다운 후 수업 기록을 종료합니다."}</p>
      </div>
      <time>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</time>
      <button type="button" disabled={busy} onClick={() => void onCancel()}>{busy ? "취소 중…" : "계속 듣기"}</button>
    </aside>
  );
}
