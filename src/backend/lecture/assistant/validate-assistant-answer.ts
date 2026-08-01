import { appendRawLog } from "../../logs/raw-log";
import {
  LectureAssistantAnswerSchema,
  StoredLectureAssistantAnswerSchema,
  type LectureAssistantAnswer,
  type LectureAssistantModelAnswer,
  type LectureSession,
} from "../../schemas";

export function validateAssistantAnswer(
  session: LectureSession,
  requestId: string,
  snapshotSequence: number,
  untrustedAnswer: LectureAssistantModelAnswer,
): LectureAssistantAnswer {
  const answer = LectureAssistantAnswerSchema.parse(untrustedAnswer);
  const allowedItemIds = new Set(
    session.transcripts
      .filter((transcript) => transcript.sequence <= snapshotSequence)
      .map((transcript) => transcript.itemId),
  );
  const referencedItemIds = Array.from(new Set(answer.referencedItemIds));
  const validReferencedItemIds = referencedItemIds.filter((itemId) =>
    allowedItemIds.has(itemId)
  );
  const invalidReferencedItemIds = referencedItemIds.filter(
    (itemId) => !allowedItemIds.has(itemId),
  );

  if (invalidReferencedItemIds.length > 0) {
    appendRawLog(session, "system", "assistant_response_rejected", {
      sessionId: session.id,
      requestId,
      snapshotSequence,
      invalidReferencedItemIds,
      reason: "invalid_or_post_snapshot_referenced_item_ids_removed",
    });
  }

  return StoredLectureAssistantAnswerSchema.parse({
    ...answer,
    referencedItemIds: validReferencedItemIds,
    answeredAt: new Date().toISOString(),
  });
}
