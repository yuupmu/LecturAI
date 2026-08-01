import { appendRawLog } from "../../logs/raw-log";
import { recordSessionError } from "../../logs/error-log";
import {
  LectureNoteSchema,
  NoteCompositionSchema,
  type CompletedLectureUnit,
  type KnowledgeUnit,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type NoteReview,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  deduplicateKnowledgeUnits,
  strongerImportance,
} from "../deduplicate-knowledge-units";
import { composeStructuredNote } from "./compose-structured-note";
import { mergeLectureNote } from "./merge-lecture-note";
import { reviewNoteGrounding } from "./review-note-grounding";
import { reviseStructuredNote } from "./revise-structured-note";

const SECTION_NAMES: Record<KnowledgeUnit["type"], string> = {
  definition: "정의",
  condition: "조건",
  process: "과정",
  formula: "공식",
  complexity: "시간복잡도",
  comparison: "비교",
  example: "예시",
  warning: "주의",
  conclusion: "결론",
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function sanitizeComposition(
  session: LectureSession,
  unit: CompletedLectureUnit,
  input: NoteComposition,
  baseRevision: number,
): NoteComposition | null {
  if (input.baseRevision !== baseRevision) return null;
  const allowedItems = new Set(unit.sourceItemIds);
  const allowedPages = new Set(
    session.materialKnowledge.outline.flatMap((topic) => topic.sourcePages),
  );
  const seen = new Set<string>();
  const sections = input.sections.flatMap((section) => {
    const items = section.items.flatMap((item) => {
      const text = item.text.replace(/\*\*/g, "").trim();
      const key = normalize(text);
      if (!key || seen.has(key)) return [];
      const sourceItemIds = Array.from(new Set(
        item.sourceItemIds.filter((itemId) => allowedItems.has(itemId)),
      ));
      const sourcePages = Array.from(new Set(
        item.sourcePages.filter((page) => allowedPages.has(page)),
      )).sort((left, right) => left - right);
      if (sourceItemIds.length === 0 && sourcePages.length === 0) return [];
      const matchingKnowledge = unit.knowledgeUnits.find((knowledge) => {
        const knowledgeKey = normalize(knowledge.text);
        return key === knowledgeKey ||
          (Math.min(key.length, knowledgeKey.length) >= 10 &&
            (key.includes(knowledgeKey) || knowledgeKey.includes(key)));
      });
      seen.add(key);
      return [{
        ...item,
        text,
        importance: matchingKnowledge
          ? strongerImportance(item.importance, matchingKnowledge.importance)
          : item.importance,
        sourceItemIds,
        sourcePages,
      }];
    });
    return items.length > 0 ? [{ ...section, items }] : [];
  });
  if (sections.length === 0) return null;
  return NoteCompositionSchema.parse({
    baseRevision,
    title: input.title.replace(/\*\*/g, "").trim() || unit.title,
    sections,
  });
}

function hasUnresolvedPronoun(note: LectureNote): boolean {
  return note.sections.some((section) => section.items.some((item) =>
    /^(?:(?:이것|그것|저것)(?:이|은|는|을|를|가)?|이게|그게|이는|(?:this|that|it)\b)/iu.test(item.text.trim())
  ));
}

function meaningOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft === normalizedRight) return true;
  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 10 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) return true;
  const leftTokens = new Set(normalizedLeft.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(normalizedRight.split(" ").filter((token) => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
}

function validateFinalNote(
  session: LectureSession,
  unit: CompletedLectureUnit,
  note: LectureNote,
): LectureNote | null {
  const parsed = LectureNoteSchema.safeParse(note);
  if (!parsed.success || hasUnresolvedPronoun(parsed.data)) return null;
  const unitSources = new Set(unit.sourceItemIds);
  const actualSources = new Set(session.transcripts.map((item) => item.itemId));
  const materialPages = new Set(
    session.materialKnowledge.outline.flatMap((topic) => topic.sourcePages),
  );
  const valid = parsed.data.sections.every((section) => {
    const keys = section.items.map((item) => normalize(item.text));
    return new Set(keys).size === keys.length && section.items.every((item) =>
      item.sourceItemIds.every(
        (itemId) => unitSources.has(itemId) && actualSources.has(itemId),
      ) && item.sourcePages.every((page) => materialPages.has(page)) &&
      (item.sourceItemIds.length > 0 || item.sourcePages.length > 0)
    );
  });
  const noteItems = parsed.data.sections.flatMap((section) => section.items);
  const coversKnowledge = unit.knowledgeUnits.every((knowledge) =>
    noteItems.some((item) => meaningOverlap(knowledge.text, item.text))
  );
  return valid && coversKnowledge ? parsed.data : null;
}

export function createFallbackNote(
  unit: CompletedLectureUnit,
  existing: LectureNote | null = null,
): LectureNote {
  const confirmed = deduplicateKnowledgeUnits(unit.knowledgeUnits).map(
    (knowledge) => ({ ...knowledge, status: "confirmed" as const }),
  );
  const types = Array.from(new Set(confirmed.map((knowledge) => knowledge.type)));
  const composition: NoteComposition = {
    baseRevision: 0,
    title: unit.title,
    sections: types.map((type) => {
      const units = confirmed
        .filter((knowledge) => knowledge.type === type)
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) -
          (right.order ?? Number.MAX_SAFE_INTEGER));
      return {
        heading: SECTION_NAMES[type],
        layout: type === "process" ? "steps" as const : "bullets" as const,
        items: units.map((knowledge) => ({
          text: knowledge.text,
          importance: knowledge.importance,
          sourceItemIds: knowledge.sourceItemIds,
          sourcePages: knowledge.sourcePages,
        })),
      };
    }),
  };
  return mergeLectureNote(unit, composition, existing);
}

function applyReviewCorrections(note: LectureNote, review: NoteReview): LectureNote {
  if (review.importanceCorrections.length === 0) return note;
  const corrections = new Map(
    review.importanceCorrections.map((correction) => [
      correction.itemId,
      correction.importance,
    ]),
  );
  return {
    ...note,
    sections: note.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        importance: corrections.get(item.id) ?? item.importance,
      })),
    })),
  };
}

function publishNote(
  session: LectureSession,
  unit: CompletedLectureUnit,
  note: LectureNote,
  startedAt: number,
  baseRevision: number,
  reason: string,
): void {
  const index = session.lectureNotes.findIndex((candidate) => candidate.unitId === unit.id);
  if (index >= 0) session.lectureNotes[index] = note;
  else session.lectureNotes.push(note);
  const completed = session.lectureMemory.completedUnits.find(
    (candidate) => candidate.id === unit.id,
  );
  if (completed) completed.noteId = note.id;
  touchSession(session);
  appendRawLog(session, "system", "note_published", {
    sessionId: session.id,
    baseRevision,
    currentRevision: session.lectureMemory.revision,
    sourceItemIds: unit.sourceItemIds,
    unitId: unit.id,
    durationMs: Date.now() - startedAt,
    reason,
  });
}

async function runNotePipeline(
  session: LectureSession,
  unit: CompletedLectureUnit,
): Promise<void> {
  const startedAt = Date.now();
  const baseRevision = session.lectureMemory.revision;
  const existing = session.lectureNotes.find((note) => note.unitId === unit.id) ?? null;
  try {
    const composition = sanitizeComposition(
      session,
      unit,
      await composeStructuredNote(session, unit, baseRevision),
      baseRevision,
    );
    if (!composition) throw new Error("NOTE_DRAFT_HAS_NO_GROUNDED_ITEMS");
    let draft = mergeLectureNote(unit, composition, existing);
    appendRawLog(session, "system", "note_draft_created", {
      sessionId: session.id,
      baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: unit.sourceItemIds,
      unitId: unit.id,
      durationMs: Date.now() - startedAt,
      reason: "structured_composer",
    });

    const review = await reviewNoteGrounding(
      session,
      unit,
      draft,
      baseRevision,
    );
    if (review.baseRevision !== baseRevision) {
      throw new Error("NOTE_REVIEW_STALE_REVISION");
    }
    appendRawLog(session, "system", "note_reviewed", {
      sessionId: session.id,
      baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: unit.sourceItemIds,
      unitId: unit.id,
      durationMs: Date.now() - startedAt,
      reason: review.publishable ? "publishable" : "revision_required",
    });

    if (review.publishable) {
      draft = applyReviewCorrections(draft, review);
    } else {
      const revision = sanitizeComposition(
        session,
        unit,
        await reviseStructuredNote(
          session,
          unit,
          draft,
          review,
          baseRevision,
        ),
        baseRevision,
      );
      if (!revision) throw new Error("NOTE_REVISION_HAS_NO_GROUNDED_ITEMS");
      draft = mergeLectureNote(unit, revision, existing);
      appendRawLog(session, "system", "note_revised", {
        sessionId: session.id,
        baseRevision,
        currentRevision: session.lectureMemory.revision,
        sourceItemIds: unit.sourceItemIds,
        unitId: unit.id,
        durationMs: Date.now() - startedAt,
        reason: review.revisionInstructions.join("; ").slice(0, 500),
      });
    }

    const validated = validateFinalNote(session, unit, draft);
    if (!validated) throw new Error("NOTE_FINAL_SERVER_VALIDATION_FAILED");
    publishNote(
      session,
      unit,
      validated,
      startedAt,
      baseRevision,
      "grounded_structured_note",
    );
  } catch (error) {
    recordSessionError(session, "structured_note_pipeline", error, {
      unitId: unit.id,
    });
    const fallback = createFallbackNote(unit, existing);
    appendRawLog(session, "system", "fallback_note_created", {
      sessionId: session.id,
      baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: unit.sourceItemIds,
      unitId: unit.id,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "unknown_note_pipeline_error",
    });
    publishNote(
      session,
      unit,
      fallback,
      startedAt,
      baseRevision,
      "deterministic_fallback",
    );
  } finally {
    session.noteGeneratingUnitIds.delete(unit.id);
    touchSession(session);
  }
}

export function queueStructuredNote(
  session: LectureSession,
  unit: CompletedLectureUnit,
): void {
  if (session.noteGeneratingUnitIds.has(unit.id) || unit.knowledgeUnits.length === 0) return;
  session.noteGeneratingUnitIds.add(unit.id);
  touchSession(session);
  const job = runNotePipeline(session, unit);
  session.noteCompositionChain = Promise.all([
    session.noteCompositionChain.catch(() => undefined),
    job,
  ]).then(() => undefined);
}
