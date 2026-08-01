import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  NoteCompositionSchema,
  type CompletedLectureUnit,
  type LectureSession,
  type NoteComposition,
} from "../../schemas";

export const NOTE_COMPOSER_PROMPT = `Compose one completed lecture unit into a concise, reviewable structured note.
Return only the requested structured output, never free-form Markdown.

- Organize definitions, conditions, processes, formulas, comparisons, examples, complexity, warnings, and conclusions into useful sections.
- Use steps layout for an ordered process and preserve the real order.
- Write short, standalone sentences without unresolved pronouns.
- Do not merely truncate each utterance; synthesize the unit while preserving meaning.
- Never add information absent from the supplied transcript/material evidence.
- Do not duplicate an idea.
- Preserve explicit importance. Do not interpret negative emphasis as important.
- Every item must cite at least one actual sourceItemId or sourcePage supplied here.
- Do not emit Markdown emphasis markers such as **. Importance is an enum.
- Copy the supplied baseRevision exactly into the output.`;

function noteEvidence(session: LectureSession, unit: CompletedLectureUnit) {
  const sourceIds = new Set(unit.sourceItemIds);
  const sourcePages = new Set(unit.knowledgeUnits.flatMap((unit) => unit.sourcePages));
  return {
    transcripts: session.transcripts
      .filter((transcript) => sourceIds.has(transcript.itemId))
      .map(({ itemId, sequence, text }) => ({ itemId, sequence, text })),
    materialTopics: session.materialKnowledge.outline.filter((topic) =>
      topic.sourcePages.some((page) => sourcePages.has(page))
    ),
  };
}

export async function composeStructuredNote(
  session: LectureSession,
  unit: CompletedLectureUnit,
  baseRevision: number,
): Promise<NoteComposition> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      { role: "system", content: NOTE_COMPOSER_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          COMPLETED_UNIT: unit,
          EVIDENCE: noteEvidence(session, unit),
          baseRevision,
        }),
      },
    ],
    text: { format: zodTextFormat(NoteCompositionSchema, "structured_note") },
  });
  if (!response.output_parsed) throw new Error("NOTE_COMPOSITION_EMPTY_OUTPUT");
  return NoteCompositionSchema.parse(response.output_parsed);
}

export { noteEvidence };
