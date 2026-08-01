import type { NoteGenerationStateDto } from "@/frontend/types";
import { LectureNoteCard } from "./LectureNoteCard";
import { NoteGenerationControls } from "./NoteGenerationControls";
import styles from "./LectureNotebook.module.css";

export function StructuredNotesPanel({
  noteGeneration,
  sessionEnded,
  hasNewTranscript,
  message,
  requestBusy,
  onGenerate,
  onToggle,
}: {
  noteGeneration: NoteGenerationStateDto;
  sessionEnded: boolean;
  hasNewTranscript: boolean;
  message: string | null;
  requestBusy: boolean;
  onGenerate: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const note = noteGeneration.finalNote ?? noteGeneration.currentNote;
  const active = noteGeneration.status === "queued" ||
    noteGeneration.status === "generating" ||
    noteGeneration.status === "reviewing";
  return (
    <section className={styles.structuredNotes} aria-label="누적 구조화 필기">
      <header>
        <strong>{noteGeneration.finalNote ? "FINAL NOTE" : "LIVE NOTE"}</strong>
        <span>REV {String(noteGeneration.revision).padStart(2, "0")}</span>
      </header>
      <div className={styles.notesScroller}>
        <NoteGenerationControls
          state={noteGeneration}
          sessionEnded={sessionEnded}
          hasNewTranscript={hasNewTranscript}
          message={message}
          requestBusy={requestBusy}
          onGenerate={onGenerate}
          onToggle={onToggle}
        />
        {noteGeneration.finalNote && (
          <div className={styles.finalNoteNotice}>
            <strong>최종 필기</strong>
            <span>수업 종료 시 전체 내용을 다시 정리한 버전</span>
          </div>
        )}
        {!note && !active && (
          <div className={styles.emptyNotes}>
            <span>WAITING FOR CHECKPOINT</span>
            <p>2분마다 새 대본을 기존 필기에 통합합니다. 원하면 지금 바로 정리할 수 있습니다.</p>
          </div>
        )}
        {active && (
          <div className={styles.noteGenerating} role="status">
            <span /> 필기의 구조와 근거를 정리하고 있습니다.
          </div>
        )}
        {note && <LectureNoteCard key={note.id} note={note} />}
      </div>
    </section>
  );
}
