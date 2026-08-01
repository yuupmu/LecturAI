"use client";

import type { LiveNoteDto } from "@/frontend/types";
import { LiveNoteBullet } from "./LiveNoteBullet";
import styles from "./LiveLecture.module.css";

// Shows only the backend-owned note for the currently resolved slide.
export function LiveNotesMargin({
  note,
  currentPage,
}: {
  note: LiveNoteDto | null;
  currentPage: number | null;
}) {
  return (
    <section className={styles.liveNotes} aria-label="슬라이드별 실시간 필기">
      <header>
        <strong>LIVE NOTES · PAGE {String(currentPage ?? 1).padStart(2, "0")}</strong>
        {note && <span>REV {String(note.revision).padStart(2, "0")}</span>}
      </header>
      {!note ? (
        <div className={styles.emptyNotes}>
          <span>LISTENING FOR STRUCTURE</span>
          <p>두 개의 완성 발화가 모이거나 중요한 순간이 오면 필기를 정리합니다.</p>
        </div>
      ) : (
        <div className={styles.noteBody}>
          <h2>{note.title}</h2>
          {note.summary && <p className={styles.noteSummary}>{note.summary}</p>}
          <ol>
            {note.bullets.map((bullet) => (
              <LiveNoteBullet key={bullet.id} bullet={bullet} />
            ))}
          </ol>
          {note.keyTerms.length > 0 && (
            <p className={styles.keyTerms}>
              <span>KEY TERMS</span>
              {note.keyTerms.join(" · ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
