import {
  NoteCompositionSchema,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type NoteReview,
} from "../../schemas";
import type { NoteGenerationContext } from "./build-note-generation-context";
import {
  normalizeNoteText,
  noteTextSimilarity,
} from "./merge-cumulative-note";

function validMaterialPages(session: LectureSession): Set<number> {
  return new Set([
    ...session.slideMap.slides.map((slide) => slide.page),
    ...session.materialKnowledge.outline.flatMap((topic) => topic.sourcePages),
  ]);
}

function allowedSourceIds(context: NoteGenerationContext): Set<string> {
  return new Set([
    ...(context.existingNote?.sourceItemIds ?? []),
    ...context.newTurnsToProcess.map((turn) => turn.itemId),
  ]);
}

function hasUnresolvedPronoun(text: string): boolean {
  return /^(?:(?:이것|그것|저것)(?:이|은|는|을|를|가)?|이게|그게|이는|(?:this|that|it)\b)/iu
    .test(text.trim());
}

function preserveExistingItems(
  composition: NoteComposition,
  existing: LectureNote | null,
): NoteComposition {
  if (!existing) return composition;
  const sections = composition.sections.map((section) => ({
    ...section,
    items: [...section.items],
  }));
  const nextItems = sections.flatMap((section) => section.items);
  for (const existingSection of existing.sections) {
    const target = sections.find(
      (section) => normalizeNoteText(section.heading) === normalizeNoteText(existingSection.heading),
    );
    for (const existingItem of existingSection.items) {
      const represented = nextItems.some((candidate) =>
        normalizeNoteText(candidate.text) === normalizeNoteText(existingItem.text) ||
        noteTextSimilarity(candidate.text, existingItem.text) >= 0.72
      );
      if (represented) continue;
      if (target) {
        target.items.push({
          text: existingItem.text,
          importance: existingItem.importance,
          sourceItemIds: existingItem.sourceItemIds,
          sourcePages: existingItem.sourcePages,
        });
      } else {
        sections.push({
          heading: existingSection.heading,
          layout: existingSection.layout,
          items: existingSection.items.map((item) => ({
            text: item.text,
            importance: item.importance,
            sourceItemIds: item.sourceItemIds,
            sourcePages: item.sourcePages,
          })),
        });
        break;
      }
    }
  }
  return { ...composition, sections };
}

function deterministicImportance(
  session: LectureSession,
  item: NoteComposition["sections"][number]["items"][number],
) {
  const evidence = session.transcripts
    .filter((turn) => item.sourceItemIds.includes(turn.itemId))
    .map((turn) => turn.text)
    .join(" ");
  const negative = /(중요하지\s*않|시험(?:에)?\s*(?:나오지\s*않|안\s*나오)|외울\s*필요\s*(?:가\s*)?없|넘어가도\s*됩|not\s+important|not\s+on\s+the\s+exam)/iu.test(evidence);
  if (negative) return "normal" as const;
  if (/(시험(?:에)?\s*(?:냅|냅니다|내겠|나옵|출제)|exam)/iu.test(evidence)) {
    return "exam" as const;
  }
  if (/(중요|반드시\s*기억|핵심|꼭\s*알아)/u.test(evidence) && item.importance === "normal") {
    return "important" as const;
  }
  return item.importance;
}

export function sanitizeCumulativeComposition(
  session: LectureSession,
  context: NoteGenerationContext,
  input: NoteComposition,
  baseRevision: number,
): NoteComposition | null {
  if (input.baseRevision !== baseRevision) return null;
  const withPreservedExisting = context.trigger === "final"
    ? input
    : preserveExistingItems(input, context.existingNote);
  const sourceIds = allowedSourceIds(context);
  const pages = validMaterialPages(session);
  const seen = new Set<string>();
  const sections = withPreservedExisting.sections.flatMap((section) => {
    const items = section.items.flatMap((item) => {
      const text = item.text.replace(/\*\*/g, "").trim();
      const key = normalizeNoteText(text);
      if (!key || seen.has(key) || hasUnresolvedPronoun(text)) return [];
      const sourceItemIds = Array.from(new Set(
        item.sourceItemIds.filter((itemId) => sourceIds.has(itemId)),
      ));
      const sourcePages = Array.from(new Set(
        item.sourcePages.filter((page) => pages.has(page)),
      )).sort((left, right) => left - right);
      if (sourceItemIds.length === 0 && sourcePages.length === 0) return [];
      seen.add(key);
      return [{
        ...item,
        text,
        importance: deterministicImportance(session, {
          ...item,
          sourceItemIds,
          sourcePages,
        }),
        sourceItemIds,
        sourcePages,
      }];
    });
    return items.length > 0
      ? [{
          heading: section.heading.replace(/\*\*/g, "").trim(),
          layout: section.layout,
          items,
        }]
      : [];
  });
  if (sections.length === 0) return null;
  return NoteCompositionSchema.parse({
    baseRevision,
    title: withPreservedExisting.title.replace(/\*\*/g, "").trim() ||
      context.existingNote?.title || "강의 필기",
    sections,
  });
}

export function validateCumulativeNote(
  session: LectureSession,
  context: NoteGenerationContext,
  note: LectureNote,
): boolean {
  if (note.processedThroughSequence !== context.snapshotSequence) return false;
  const sourceIds = allowedSourceIds(context);
  const pages = validMaterialPages(session);
  const keys = note.sections.flatMap((section) =>
    section.items.map((item) => normalizeNoteText(item.text))
  );
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return false;
  return note.sections.every((section) => section.items.every((item) =>
    !hasUnresolvedPronoun(item.text) &&
    item.sourceItemIds.every((itemId) => sourceIds.has(itemId)) &&
    item.sourcePages.every((page) => pages.has(page)) &&
    (item.sourceItemIds.length > 0 || item.sourcePages.length > 0)
  ));
}

export function applyNoteReviewCorrections(
  note: LectureNote,
  review: NoteReview,
): LectureNote {
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
