import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteReviewSchema,
  type LectureNote,
  type LectureSession,
  type NoteReview,
} from "../../schemas";
import type { NoteGenerationContext } from "./build-note-generation-context";
import { getNoteModel } from "./note-model";

const CUMULATIVE_NOTE_REVIEW_PROMPT = `Review the complete cumulative lecture note using only the supplied evidence.
Return structured output only. Check unsupported content, omitted new learning points, duplicates, process order, unresolved pronouns, positive and negative emphasis, questions or hypotheses written as facts, accidental deletion of correct existing content, needless structural churn, and invalid source ids/pages. Do not add external facts. Copy BASE_REVISION exactly.`;

export async function reviewCumulativeNote(
  session: LectureSession,
  context: NoteGenerationContext,
  note: LectureNote,
  baseRevision: number,
): Promise<NoteReview> {
  const response = await getOpenAIClient().responses.parse({
    model: getNoteModel(context.trigger),
    input: [
      { role: "system", content: CUMULATIVE_NOTE_REVIEW_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          NOTE: note,
          EXISTING_NOTE: context.existingNote,
          CONTEXT_ONLY_TURNS: context.contextOnlyTurns,
          NEW_TURNS_TO_PROCESS: context.newTurnsToProcess,
          MATERIAL_KNOWLEDGE: session.materialKnowledge,
          BASE_REVISION: baseRevision,
        }),
      },
    ],
    text: {
      format: zodTextFormat(NoteReviewSchema, "cumulative_note_review"),
    },
  });
  if (!response.output_parsed) throw new Error("NOTE_REVIEW_EMPTY_OUTPUT");
  return NoteReviewSchema.parse(response.output_parsed);
}
