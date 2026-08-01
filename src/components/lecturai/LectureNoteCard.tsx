import type { LectureNoteDto } from "@/frontend/types";
import styles from "./LectureNotebook.module.css";

export function LectureNoteCard({ note }: { note: LectureNoteDto }) {
  return (
    <article className={styles.noteCard}>
      <header>
        <h3>{note.title}</h3>
        <span>
          {note.status === "final" ? "FINAL" : "LIVE"} · REV {String(note.revision).padStart(2, "0")}
        </span>
      </header>
      {note.sections.map((section) => (
        <section key={section.id} className={styles.noteSection}>
          <h4>{section.heading}</h4>
          {section.layout === "steps" ? (
            <ol>
              {section.items.map((item) => <NoteText key={item.id} item={item} />)}
            </ol>
          ) : (
            <ul>
              {section.items.map((item) => <NoteText key={item.id} item={item} />)}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}

function NoteText({
  item,
}: {
  item: LectureNoteDto["sections"][number]["items"][number];
}) {
  const content = item.importance === "normal"
    ? item.text
    : <strong>{item.text}</strong>;
  return (
    <li data-source-item-ids={item.sourceItemIds.join(" ")}>
      {content}
      {item.importance === "exam" && (
        <span className={styles.examBadge} aria-label="시험 강조">시험</span>
      )}
    </li>
  );
}
