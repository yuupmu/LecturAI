import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteCompositionSchema,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type NoteReview,
} from "../../schemas";
import type { NoteGenerationContext } from "./build-note-generation-context";
import { getNoteModel } from "./note-model";

const CUMULATIVE_NOTE_REVISION_PROMPT = `Revise the complete cumulative note exactly once according to the grounding review. Return the whole note as structured output. Remove unsupported or duplicated content, restore grounded omissions, preserve correct existing content, fix real process order and importance, and resolve pronouns. Use only supplied evidence, never Markdown **, and copy BASE_REVISION exactly.`;

export async function reviseCumulativeNote(
  session: LectureSession,
  context: NoteGenerationContext,
  note: LectureNote,
  review: NoteReview,
  baseRevision: number,
): Promise<NoteComposition> {
  const response = await getOpenAIClient().responses.parse({
    model: getNoteModel(context.trigger),
    input: [
      { role: "system", content: CUMULATIVE_NOTE_REVISION_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          DRAFT_NOTE: note,
          REVIEW: review,
          EXISTING_NOTE: context.existingNote,
          CONTEXT_ONLY_TURNS: context.contextOnlyTurns,
          NEW_TURNS_TO_PROCESS: context.newTurnsToProcess,
          MATERIAL_KNOWLEDGE: session.materialKnowledge,
          BASE_REVISION: baseRevision,
        }),
      },
    ],
    text: {
      format: zodTextFormat(NoteCompositionSchema, "revised_cumulative_note"),
    },
  });
  if (!response.output_parsed) throw new Error("NOTE_REVISION_EMPTY_OUTPUT");
  return NoteCompositionSchema.parse(response.output_parsed);
}
