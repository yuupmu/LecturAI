import { randomUUID } from "node:crypto";
import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import {
  LiveNoteSchema,
  LiveNoteSynthesisSchema,
  type EmphasisEvent,
  type LectureSession,
  type LiveNote,
  type LiveNoteBullet,
  type Slide,
  type Transcript,
} from "../schemas";
import { normalizeText, tokenizeForMatch } from "../transcript/normalize-text";
import { LIVE_NOTE_PROMPT } from "./live-note-prompt";

// Produces a complete replacement note while retaining stable server-side IDs.
export async function synthesizeLiveNote(
  session: LectureSession,
  slide: Slide,
  existingNote: LiveNote | null,
  newTranscripts: Transcript[],
): Promise<LiveNote> {
  const emphasisEvents = session.events
    .filter(
      (event): event is EmphasisEvent =>
        event.type === "emphasis" && event.slidePage === slide.page,
    )
    .slice(-5);
  const verificationEvents = session.events
    .filter(
      (event) => event.type === "verification" && event.slidePage === slide.page,
    )
    .slice(-5);
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_FAST_MODEL,
    input: [
      { role: "system", content: LIVE_NOTE_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          SLIDE: slide,
          EXISTING_NOTE: existingNote,
          NEW_TRANSCRIPTS: newTranscripts,
          RECENT_EMPHASIS_EVENTS: emphasisEvents,
          RECENT_VERIFICATION_EVENTS: verificationEvents,
        }),
      },
    ],
    text: {
      format: zodTextFormat(LiveNoteSynthesisSchema, "live_note"),
    },
  });
  if (!response.output_parsed) throw new Error("LIVE_NOTE_EMPTY_OUTPUT");
  const output = LiveNoteSynthesisSchema.parse(response.output_parsed);
  const allowedSequences = new Set([
    ...(existingNote?.bullets.flatMap((bullet) => bullet.sourceSequences) ?? []),
    ...newTranscripts.map((transcript) => transcript.sequence),
  ]);
  const bullets = output.bullets.map((bullet) => {
    const sourceSequences = Array.from(
      new Set(bullet.sourceSequences.filter((sequence) => allowedSequences.has(sequence))),
    );
    const existing = findExistingBullet(existingNote?.bullets ?? [], {
      ...bullet,
      sourceSequences,
    });
    return {
      id: existing?.id ?? randomUUID(),
      text: bullet.text,
      kind: bullet.kind,
      emphasized: false,
      sourceSequences,
    } satisfies LiveNoteBullet;
  });
  const maxSequence = Math.max(
    existingNote?.lastProcessedSequence ?? 0,
    ...newTranscripts.map((transcript) => transcript.sequence),
  );
  const note = LiveNoteSchema.parse({
    id: existingNote?.id ?? randomUUID(),
    slidePage: slide.page,
    title: output.title || slide.title,
    summary: output.summary,
    bullets,
    keyTerms: output.keyTerms,
    lastProcessedSequence: maxSequence,
    revision: (existingNote?.revision ?? 0) + 1,
    updatedAt: Date.now(),
  });
  return applyEmphasisToNote(note, emphasisEvents);
}

// Reconciles model-created bullets with deterministic emphasis evidence.
export function applyEmphasisToLiveNotes(session: LectureSession): boolean {
  let changed = false;
  session.liveNotes = session.liveNotes.map((note) => {
    const emphasis = session.events.filter(
      (event): event is EmphasisEvent =>
        event.type === "emphasis" && event.slidePage === note.slidePage,
    );
    const next = applyEmphasisToNote(note, emphasis);
    if (next !== note) changed = true;
    return next;
  });
  return changed;
}

function applyEmphasisToNote(
  note: LiveNote,
  emphasisEvents: EmphasisEvent[],
): LiveNote {
  let changed = false;
  const bullets = note.bullets.map((bullet) => {
    const emphasized = emphasisEvents.some((event) =>
      emphasisMatchesBullet(event, bullet, note.keyTerms),
    );
    if (bullet.emphasized === emphasized) return bullet;
    changed = true;
    return { ...bullet, emphasized };
  });

  const unmatched = emphasisEvents.filter(
    (event) => !bullets.some((bullet) => emphasisMatchesBullet(event, bullet, note.keyTerms)),
  );
  for (const event of unmatched) {
    if (bullets.length >= 8) break;
    bullets.push({
      id: randomUUID(),
      text: event.resolvedConcept,
      kind: emphasisKindToBulletKind(event.emphasisKind),
      emphasized: true,
      sourceSequences: event.sourceSequences,
    });
    changed = true;
  }

  return changed
    ? {
        ...note,
        bullets,
        revision: note.revision + 1,
        updatedAt: Date.now(),
      }
    : note;
}

function findExistingBullet(
  existing: LiveNoteBullet[],
  candidate: Pick<LiveNoteBullet, "text" | "kind" | "sourceSequences">,
): LiveNoteBullet | undefined {
  return existing.find((bullet) => {
    if (bullet.kind !== candidate.kind) return false;
    if (bullet.sourceSequences.some((sequence) => candidate.sourceSequences.includes(sequence))) {
      return true;
    }
    return textSimilarity(bullet.text, candidate.text) >= 0.72;
  });
}

function emphasisMatchesBullet(
  event: EmphasisEvent,
  bullet: LiveNoteBullet,
  keyTerms: string[],
): boolean {
  const similarity = textSimilarity(event.resolvedConcept, bullet.text);
  const containment = textContainment(event.resolvedConcept, bullet.text);
  const sharedSource = event.sourceSequences.some((sequence) =>
    bullet.sourceSequences.includes(sequence),
  );
  if (
    similarity >= 0.42 ||
    containment >= 0.3 ||
    (sharedSource && containment >= 0.16)
  ) return true;
  const concept = normalizeText(event.resolvedConcept);
  const matchingTerms = keyTerms.filter((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm.length >= 2 && concept.includes(normalizedTerm) &&
      normalizeText(bullet.text).includes(normalizedTerm);
  });
  return matchingTerms.length >= 2 ||
    matchingTerms.some((term) => normalizeText(term).length >= 6);
}

function textSimilarity(left: string, right: string): number {
  const a = new Set(tokenizeForMatch(left));
  const b = new Set(tokenizeForMatch(right));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function textContainment(left: string, right: string): number {
  const a = new Set(tokenizeForMatch(left));
  const b = new Set(tokenizeForMatch(right));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

function emphasisKindToBulletKind(
  kind: EmphasisEvent["emphasisKind"],
): LiveNoteBullet["kind"] {
  if (kind === "definition") return "definition";
  if (kind === "caution") return "caution";
  if (kind === "contrast") return "comparison";
  return "concept";
}
