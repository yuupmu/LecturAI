import { recordSessionError } from "../logs/error-log";
import type { LectureSession, Transcript } from "../schemas";
import { touchSession } from "../session-store";
import { synthesizeLiveNote } from "./synthesize-live-note";

export const NOTE_BATCH_SIZE = 2;
export const NOTE_MAX_DELAY_MS = 8_000;

interface NoteScheduleOptions {
  slideChanged?: boolean;
  force?: boolean;
}

// Adds one finalized segment and flushes notes only at the configured boundaries.
export function scheduleLiveNoteUpdate(
  session: LectureSession,
  transcript: Transcript,
  options: NoteScheduleOptions = {},
): Promise<void> {
  if (!session.pendingNoteSequences.includes(transcript.sequence)) {
    session.pendingNoteSequences.push(transcript.sequence);
  }
  const elapsed = Date.now() - session.lastNoteUpdateAt;
  const shouldFlush =
    options.force === true ||
    options.slideChanged === true ||
    session.pendingNoteSequences.length >= NOTE_BATCH_SIZE ||
    elapsed >= NOTE_MAX_DELAY_MS;
  if (shouldFlush) return queueNoteFlush(session);

  if (!session.noteUpdateTimer) {
    session.noteUpdateTimer = setTimeout(() => {
      session.noteUpdateTimer = null;
      void queueNoteFlush(session);
    }, Math.max(1, NOTE_MAX_DELAY_MS - elapsed));
  }
  return Promise.resolve();
}

export function flushPendingLiveNotes(session: LectureSession): Promise<void> {
  return queueNoteFlush(session);
}

function queueNoteFlush(session: LectureSession): Promise<void> {
  if (session.noteUpdateTimer) {
    clearTimeout(session.noteUpdateTimer);
    session.noteUpdateTimer = null;
  }
  const update = async () => {
    const pending = Array.from(new Set(session.pendingNoteSequences));
    session.pendingNoteSequences = [];
    if (pending.length === 0) return;

    const pendingSet = new Set(pending);
    const pages = Array.from(
      new Set(
        session.transcripts
          .filter((transcript) => pendingSet.has(transcript.sequence))
          .map((transcript) => transcript.matchedSlidePage)
          .filter((page): page is number => page !== null && page !== undefined),
      ),
    );
    for (const page of pages) {
      const slide = session.slideMap.slides.find((candidate) => candidate.page === page);
      if (!slide) continue;
      const existing = session.liveNotes.find((note) => note.slidePage === page) ?? null;
      const maxPending = Math.max(
        ...session.transcripts
          .filter(
            (transcript) =>
              pendingSet.has(transcript.sequence) && transcript.matchedSlidePage === page,
          )
          .map((transcript) => transcript.sequence),
      );
      const newTranscripts = session.transcripts.filter(
        (transcript) =>
          transcript.matchedSlidePage === page &&
          transcript.sequence > (existing?.lastProcessedSequence ?? -1) &&
          transcript.sequence <= maxPending,
      );
      if (newTranscripts.length === 0) continue;

      try {
        const note = await synthesizeLiveNote(
          session,
          slide,
          existing,
          newTranscripts,
        );
        const index = session.liveNotes.findIndex(
          (candidate) => candidate.slidePage === page,
        );
        if (index >= 0) session.liveNotes[index] = note;
        else session.liveNotes.push(note);
        session.lastNoteUpdateAt = Date.now();
        touchSession(session);
      } catch (error) {
        recordSessionError(session, "live_note_synthesis", error, {
          slidePage: page,
          sequences: newTranscripts.map((transcript) => transcript.sequence),
        });
      }
    }
  };

  session.noteUpdateChain = session.noteUpdateChain
    .catch(() => undefined)
    .then(update)
    .catch((error) => {
      recordSessionError(session, "live_note_update_chain", error);
    });
  return session.noteUpdateChain;
}
