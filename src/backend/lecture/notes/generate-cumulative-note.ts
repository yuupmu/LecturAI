import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteCompositionSchema,
  type LectureNote,
  type LectureSession,
  type MaterialKnowledge,
  type NoteComposition,
} from "../../schemas";
import type { NoteGenerationContext } from "./build-note-generation-context";
import { getNoteModel } from "./note-model";

export const CUMULATIVE_NOTE_PROMPT = `You maintain one cumulative structured lecture note.
Return the complete latest note as structured output, never Markdown.

Rules:
- EXISTING_NOTE is the current document. Keep, edit, merge, move, reorder, or remove duplicated content as needed.
- CONTEXT_ONLY_TURNS exist only to resolve pronouns and transitions. Do not add them again as new content.
- Integrate NEW_TURNS_TO_PROCESS into the existing note. Return the whole updated document, not a delta and not a separate time-window card.
- Organize definitions, conditions, ordered processes, formulas, comparisons, examples, warnings, complexity, and conclusions into reviewable sections.
- Use steps only when order matters. Resolve pronouns into standalone learning statements.
- Ignore greetings, attendance, equipment problems, chatter, questions, and unsupported hypotheses.
- Use only supplied transcript and material evidence. Never add general knowledge.
- Every item must cite actual sourceItemIds and/or material sourcePages supplied in the input.
- Preserve explicit positive importance as important or exam. Never promote negative phrases such as "중요하지 않습니다" or "시험에 나오지 않습니다".
- Do not emit **. Importance is represented only by the enum.
- Keep a good existing structure stable unless the new content requires a change.
- Copy BASE_REVISION exactly.`;

const MAX_MODEL_NOTE_CHARACTERS = 120_000;
const MAX_MODEL_MATERIAL_CHARACTERS = 120_000;

// The authoritative note remains untouched in session state. Only an oversized
// model packet is compacted, prioritizing emphasized items and section coverage.
function noteForModel(note: LectureNote | null): LectureNote | null {
  if (!note || JSON.stringify(note).length <= MAX_MODEL_NOTE_CHARACTERS) return note;
  return {
    ...note,
    sections: note.sections.map((section) => {
      const emphasized = section.items.filter((item) => item.importance !== "normal");
      const ordinary = section.items.filter((item) => item.importance === "normal");
      const keptIds = new Set(emphasized.map((item) => item.id));
      return {
        ...section,
        items: [
          ...emphasized,
          ...ordinary.filter((item) => !keptIds.has(item.id)).slice(0, 24),
        ],
      };
    }),
  };
}

function materialForModel(material: MaterialKnowledge): MaterialKnowledge {
  if (JSON.stringify(material).length <= MAX_MODEL_MATERIAL_CHARACTERS) {
    return material;
  }
  return {
    ...material,
    outline: material.outline.slice(0, 80).map((topic) => ({
      ...topic,
      definitions: topic.definitions.slice(0, 12),
      conditions: topic.conditions.slice(0, 12),
      processes: topic.processes.slice(0, 12),
      formulas: topic.formulas.slice(0, 12),
      comparisons: topic.comparisons.slice(0, 8),
      examples: topic.examples.slice(0, 8),
      warnings: topic.warnings.slice(0, 8),
    })),
    terminology: material.terminology.slice(0, 160),
  };
}

export async function generateCumulativeNote(
  session: LectureSession,
  context: NoteGenerationContext,
  baseRevision: number,
): Promise<NoteComposition> {
  const response = await getOpenAIClient().responses.parse({
    model: getNoteModel(context.trigger),
    input: [
      { role: "system", content: CUMULATIVE_NOTE_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          TRIGGER: context.trigger,
          EXISTING_NOTE: noteForModel(context.existingNote),
          CONTEXT_ONLY_TURNS: context.contextOnlyTurns.map(
            ({ itemId, sequence, text }) => ({ itemId, sequence, text }),
          ),
          NEW_TURNS_TO_PROCESS: context.newTurnsToProcess.map(
            ({ itemId, sequence, text }) => ({ itemId, sequence, text }),
          ),
          MATERIAL_KNOWLEDGE: materialForModel(context.materialKnowledge),
          SNAPSHOT_SEQUENCE: context.snapshotSequence,
          LAST_PROCESSED_SEQUENCE: context.lastProcessedSequence,
          BASE_REVISION: baseRevision,
        }),
      },
    ],
    text: {
      format: zodTextFormat(NoteCompositionSchema, "cumulative_lecture_note"),
    },
  });
  if (!response.output_parsed) throw new Error("NOTE_COMPOSITION_EMPTY_OUTPUT");
  return NoteCompositionSchema.parse(response.output_parsed);
}
