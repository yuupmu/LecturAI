import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteReviewSchema,
  type CompletedLectureUnit,
  type LectureNote,
  type LectureSession,
  type NoteReview,
} from "../../schemas";
import { noteEvidence } from "./compose-structured-note";

const GROUNDING_REVIEW_PROMPT = `Review the structured lecture note against only the supplied evidence.
Return only structured output.

Check whether every item is grounded, whether unsupported explanation was added, whether a core condition/formula was omitted, whether process order is wrong, whether explicit positive importance was preserved, whether negative emphasis was incorrectly promoted, whether items are duplicated, and whether every sentence is independently understandable without pronouns.
Mark publishable=false when revision is needed. Refer to the note's actual item ids and knowledge-unit ids. Do not add external facts. Copy the supplied baseRevision exactly into the output.`;

export async function reviewNoteGrounding(
  session: LectureSession,
  unit: CompletedLectureUnit,
  note: LectureNote,
  baseRevision: number,
): Promise<NoteReview> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      { role: "system", content: GROUNDING_REVIEW_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          NOTE: note,
          KNOWLEDGE_UNITS: unit.knowledgeUnits,
          EVIDENCE: noteEvidence(session, unit),
          baseRevision,
        }),
      },
    ],
    text: { format: zodTextFormat(NoteReviewSchema, "note_grounding_review") },
  });
  if (!response.output_parsed) throw new Error("NOTE_REVIEW_EMPTY_OUTPUT");
  return NoteReviewSchema.parse(response.output_parsed);
}
