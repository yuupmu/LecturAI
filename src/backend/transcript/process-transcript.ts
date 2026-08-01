import { recordSessionError } from "../logs/error-log";
import {
  TranscriptInputSchema,
  TranscriptSchema,
  type AgentActionName,
  type LectureSession,
  type TranscriptInput,
} from "../schemas";
import { touchSession } from "../session-store";
import { runLectureMonitorAgent } from "../agent/run-agent";
import { matchSlides } from "./slide-matcher";

// Saves immediately, then serializes all model analysis on the session promise chain.
export async function processTranscript(
  session: LectureSession,
  untrustedInput: TranscriptInput,
): Promise<{ action: AgentActionName; duplicate: boolean; version: number }> {
  const input = TranscriptInputSchema.parse(untrustedInput);
  if (session.processedItemIds.has(input.itemId)) {
    return { action: "none", duplicate: true, version: session.version };
  }

  const previousTranscripts = session.transcripts.slice(-3);
  const matches = matchSlides(
    input.text,
    session.slideMap,
    session.currentSlidePage,
  );
  const transcript = TranscriptSchema.parse({
    ...input,
    matchedSlidePages: matches.map((match) => match.slide.page),
  });

  session.processedItemIds.add(input.itemId);
  session.transcripts.push(transcript);
  if ((matches[0]?.score ?? 0) > 0) {
    session.currentSlidePage = matches[0].slide.page;
  }
  if (session.status === "ready") session.status = "listening";
  touchSession(session);

  let action: AgentActionName = "none";
  const analysis = async () => {
    try {
      action = await runLectureMonitorAgent(session, {
        newTranscript: transcript,
        previousTranscripts,
        relatedSlides: matches.map((match) => match.slide),
      });
    } catch (error) {
      action = "none";
      recordSessionError(session, "lecture_monitor_agent", error, {
        itemId: input.itemId,
      });
    }
  };

  session.analysisChain = session.analysisChain.catch(() => undefined).then(analysis);
  await session.analysisChain;
  return { action, duplicate: false, version: session.version };
}
