import { randomUUID } from "node:crypto";
import {
  LectureNoteSchema,
  type CompletedLectureUnit,
  type LectureNote,
  type NoteComposition,
} from "../../schemas";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function mergeLectureNote(
  unit: CompletedLectureUnit,
  composition: NoteComposition,
  existing: LectureNote | null,
): LectureNote {
  const now = new Date().toISOString();
  const sections = composition.sections.map((section) => {
    const existingSection = existing?.sections.find(
      (candidate) => normalize(candidate.heading) === normalize(section.heading),
    );
    return {
      id: existingSection?.id ?? randomUUID(),
      heading: section.heading,
      layout: section.layout,
      items: section.items.map((item) => {
        const existingItem = existingSection?.items.find(
          (candidate) => normalize(candidate.text) === normalize(item.text),
        );
        return {
          id: existingItem?.id ?? randomUUID(),
          text: item.text.replace(/\*\*/g, "").trim(),
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
    id: existing?.id ?? randomUUID(),
    unitId: unit.id,
    title: composition.title,
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
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}
