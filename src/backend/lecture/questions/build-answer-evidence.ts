import {
  LectureAnswerSchema,
  type LectureAnswer,
  type LectureAnswerDraft,
  type LectureAnswerEvidence,
} from "../../schemas";
import type { LectureQuestionContext } from "./build-question-context";

export function publishGroundedAnswer(
  context: LectureQuestionContext,
  draft: LectureAnswerDraft,
): LectureAnswer | null {
  if (!draft.answerable || !draft.shortAnswer.trim() || !draft.explanation.trim()) {
    return null;
  }
  const evidence = draft.evidenceRefs.flatMap((reference) => {
    const resolved = resolveEvidence(context, reference);
    return resolved ? [resolved] : [];
  });
  const uniqueEvidence = Array.from(new Map(evidence.map((item) => [
    `${item.type}:${item.noteId ?? ""}:${item.sourcePage ?? ""}:${item.sourceItemIds.join(",")}`,
    item,
  ])).values());
  if (uniqueEvidence.length === 0) return null;

  return LectureAnswerSchema.parse({
    text: draft.explanation.trim(),
    shortAnswer: draft.shortAnswer.trim(),
    keyPoints: draft.keyPoints.map((point) => point.trim()).filter(Boolean),
    evidence: uniqueEvidence,
    basedOn: answerBasis(uniqueEvidence),
    styleProfileRevision: context.professorStyle?.revision ?? null,
    answeredAt: new Date().toISOString(),
  });
}

function resolveEvidence(
  context: LectureQuestionContext,
  reference: LectureAnswerDraft["evidenceRefs"][number],
): LectureAnswerEvidence | null {
  if (reference.type === "transcript") {
    const requested = new Set(reference.sourceItemIds);
    const turns = context.transcriptContext.filter((turn) => requested.has(turn.itemId));
    if (turns.length === 0 || turns.length !== requested.size) return null;
    return {
      type: "transcript",
      sourcePage: null,
      sourceItemIds: turns.map((turn) => turn.itemId),
      noteId: null,
      label: `수업 대본 #${turns[0].sequence}${turns.length > 1 ? `–#${turns.at(-1)?.sequence}` : ""}`,
      excerpt: turns.map((turn) => turn.text).join(" ").slice(0, 800),
    };
  }
  if (reference.type === "material") {
    const entry = context.materialContext.find((material) =>
      material.sourcePage === reference.sourcePage &&
      (reference.sourceItemIds.length === 0 || reference.sourceItemIds.includes(material.id))
    );
    if (!entry) return null;
    return {
      type: "material",
      sourcePage: entry.sourcePage,
      sourceItemIds: [entry.id],
      noteId: null,
      label: `PPT/PDF ${entry.sourcePage}쪽 · ${entry.label}`,
      excerpt: entry.text.slice(0, 800),
    };
  }
  if (reference.type === "structured_note") {
    const entry = context.noteContext.find((note) => note.noteId === reference.noteId);
    if (!entry) return null;
    const requested = reference.sourceItemIds.length > 0
      ? reference.sourceItemIds.filter((itemId) => entry.sourceItemIds.includes(itemId))
      : entry.sourceItemIds;
    return {
      type: "structured_note",
      sourcePage: reference.sourcePage && entry.sourcePages.includes(reference.sourcePage)
        ? reference.sourcePage
        : entry.sourcePages[0] ?? null,
      sourceItemIds: requested,
      noteId: entry.noteId,
      label: entry.label,
      excerpt: entry.text.slice(0, 800),
    };
  }
  const open = context.openUnitContext;
  if (!open) return null;
  const requested = reference.sourceItemIds.length > 0
    ? reference.sourceItemIds.filter((itemId) => open.sourceItemIds.includes(itemId))
    : open.sourceItemIds;
  if (reference.sourceItemIds.length > 0 && requested.length === 0) return null;
  return {
    type: "open_unit",
    sourcePage: reference.sourcePage && open.sourcePages.includes(reference.sourcePage)
      ? reference.sourcePage
      : open.sourcePages[0] ?? null,
    sourceItemIds: requested,
    noteId: null,
    label: `현재 열린 단원 · ${open.title}`,
    excerpt: open.text.slice(0, 800),
  };
}

function answerBasis(evidence: LectureAnswerEvidence[]): LectureAnswer["basedOn"] {
  const types = new Set(evidence.map((item) => item.type));
  if (types.has("structured_note") && (types.has("transcript") || types.has("open_unit"))) {
    return "notes_and_transcript";
  }
  if (types.has("material") && (types.has("transcript") || types.has("open_unit"))) {
    return "material_and_transcript";
  }
  if (types.size === 1 && types.has("material")) return "material_only";
  return "transcript_only";
}
