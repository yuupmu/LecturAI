import { randomUUID } from "node:crypto";
import {
  LectureNoteSchema,
  type LectureNote,
  type NoteComposition,
} from "../../schemas";

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function sourceOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((value) => rightSet.has(value)).length;
  return shared / Math.min(left.length, right.length);
}

export function mergeCumulativeNote(
  composition: NoteComposition,
  existing: LectureNote | null,
  status: LectureNote["status"],
  processedThroughSequence: number,
): LectureNote {
  const now = new Date().toISOString();
  const existingItems = existing?.sections.flatMap((section) => section.items) ?? [];
  const usedItemIds = new Set<string>();
  const sections = composition.sections.map((section, sectionIndex) => {
    const existingSection = existing?.sections.find(
      (candidate) => normalize(candidate.heading) === normalize(section.heading),
    ) ?? existing?.sections[sectionIndex];
    return {
      id: existingSection?.id ?? randomUUID(),
      heading: section.heading.replace(/\*\*/g, "").trim(),
      layout: section.layout,
      items: section.items.map((item) => {
        const text = item.text.replace(/\*\*/g, "").trim();
        const existingItem = existingItems
          .filter((candidate) => !usedItemIds.has(candidate.id))
          .map((candidate) => ({
            candidate,
            exact: normalize(candidate.text) === normalize(text),
            sources: sourceOverlap(candidate.sourceItemIds, item.sourceItemIds),
            similarity: tokenSimilarity(candidate.text, text),
          }))
          .filter((match) =>
            match.exact ||
            match.similarity >= 0.78 ||
            (match.sources > 0 && match.similarity >= 0.34)
          )
          .sort((left, right) =>
            Number(right.exact) - Number(left.exact) ||
            right.similarity - left.similarity ||
            right.sources - left.sources
          )[0]?.candidate;
        if (existingItem) usedItemIds.add(existingItem.id);
        return {
          id: existingItem?.id ?? randomUUID(),
          text,
          importance: item.importance,
          sourceItemIds: Array.from(new Set(item.sourceItemIds)),
          sourcePages: Array.from(new Set(item.sourcePages)).sort(
            (left, right) => left - right,
          ),
        };
      }),
    };
  });

  return LectureNoteSchema.parse({
    id: status === "live" && existing ? existing.id : randomUUID(),
    unitId: "cumulative-lecture-note",
    status,
    title: composition.title.replace(/\*\*/g, "").trim(),
    sections,
    sourceItemIds: Array.from(new Set(
      sections.flatMap((section) =>
        section.items.flatMap((item) => item.sourceItemIds)
      ),
    )),
    sourcePages: Array.from(new Set(
      sections.flatMap((section) =>
        section.items.flatMap((item) => item.sourcePages)
      ),
    )).sort((left, right) => left - right),
    processedThroughSequence,
    revision: (existing?.revision ?? 0) + 1,
    createdAt: status === "live" && existing ? existing.createdAt : now,
    updatedAt: now,
  });
}

export { normalize as normalizeNoteText, tokenSimilarity as noteTextSimilarity };
