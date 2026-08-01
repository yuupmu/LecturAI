import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteCompositionSchema,
  type CompletedLectureUnit,
  type LectureNote,
  type LectureSession,
  type NoteComposition,
  type NoteReview,
} from "../../schemas";
import { noteEvidence } from "./compose-structured-note";

const NOTE_REVISION_PROMPT = `Revise the structured note exactly once from the grounding review.
Return only the requested structured output. Remove unsupported or duplicate content, restore grounded omissions, correct importance and real process order, and replace unresolved pronouns. Use only supplied evidence. Never emit Markdown ** markers. Every item needs actual sourceItemIds or sourcePages. Copy the supplied baseRevision exactly into the output.`;

export async function reviseStructuredNote(
  session: LectureSession,
  unit: CompletedLectureUnit,
  note: LectureNote,
  review: NoteReview,
  baseRevision: number,
): Promise<NoteComposition> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      { role: "system", content: NOTE_REVISION_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          DRAFT_NOTE: note,
          REVIEW: review,
          KNOWLEDGE_UNITS: unit.knowledgeUnits,
          EVIDENCE: noteEvidence(session, unit),
          baseRevision,
        }),
      },
    ],
    text: { format: zodTextFormat(NoteCompositionSchema, "revised_note") },
  });
  if (!response.output_parsed) throw new Error("NOTE_REVISION_EMPTY_OUTPUT");
  return NoteCompositionSchema.parse(response.output_parsed);
}
