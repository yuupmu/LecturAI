import { run } from "@openai/agents";
import { z } from "zod";
import { appendRawLog } from "../logs/raw-log";
import type {
  ActionControl,
  AgentActionName,
  LectureSession,
  Slide,
  Transcript,
} from "../schemas";
import { createLectureMonitorAgent } from "./lecture-monitor-agent";

const NoActionSchema = z.literal("NO_ACTION");

interface AgentTurnInput {
  newTranscript: Transcript;
  previousTranscripts: Transcript[];
  relatedSlides: Slide[];
}

// Streams and logs the entire SDK event sequence before validating the outcome.
export async function runLectureMonitorAgent(
  session: LectureSession,
  turn: AgentTurnInput,
): Promise<AgentActionName> {
  const control: ActionControl = { actionTaken: false, action: "none" };
  const agent = createLectureMonitorAgent(session, control, turn.newTranscript);
  const recentEvents = session.events.slice(-5);
  const currentSlide = session.slideMap.slides.find(
    (slide) => slide.page === session.currentSlidePage,
  ) ?? null;
  const currentLiveNote = session.liveNotes.find(
    (note) => note.slidePage === session.currentSlidePage,
  ) ?? null;
  const recentEmphasisEvents = session.events
    .filter((event) => event.type === "emphasis")
    .slice(-5);
  const input = JSON.stringify({
    instruction: session.instruction,
    NEW_TRANSCRIPT: turn.newTranscript,
    RECENT_TRANSCRIPTS: turn.previousTranscripts.slice(-5),
    CURRENT_SLIDE: currentSlide,
    CURRENT_LIVE_NOTE: currentLiveNote,
    RECENT_EMPHASIS_EVENTS: recentEmphasisEvents,
    relatedSlides: turn.relatedSlides,
    recentEvents,
    sessionStatus: session.status,
  });

  const stream = await run(agent, input, { stream: true });
  for await (const event of stream) {
    appendRawLog(session, "agent_stream", event.type, event);
  }
  await stream.completed;

  if (control.actionTaken) return control.action;
  const output = typeof stream.finalOutput === "string"
    ? stream.finalOutput.trim()
    : stream.finalOutput;
  NoActionSchema.parse(output);
  return "none";
}
