import { getEnv } from "../../env";
import type { NoteGenerationTrigger } from "../../schemas";

// Keep frequent checkpoints inexpensive while reserving a higher-quality
// configured model for the one final note produced when the lecture ends.
export function getNoteModel(trigger: NoteGenerationTrigger): string {
  const env = getEnv();
  if (trigger === "scheduled") return env.OPENAI_FAST_MODEL;
  if (trigger === "final") return env.OPENAI_FINAL_NOTE_MODEL;
  return env.OPENAI_SMART_MODEL;
}
