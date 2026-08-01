import type {
  LectureNote,
  LectureSession,
  LiveNote,
  MaterialKnowledge,
  MissedFlowRequest,
  SlideMap,
  Transcript,
} from "../../schemas";

const LOOKBACK_MS = 90_000;

export interface MissedFlowContext {
  requestId: string;
  clickedAt: string;
  clickedAtSequence: number;
  captureEndsAt: string;
  beforeTurns: Transcript[];
  buttonPoint: Transcript | null;
  afterTurns: Transcript[];
  materialKnowledge: MaterialKnowledge;
  slideMap: SlideMap;
  currentStructuredNotes: LectureNote[];
  currentLiveNotes: LiveNote[];
  currentSlidePage: number | null;
}

export function buildMissedFlowContext(
  session: LectureSession,
  request: MissedFlowRequest,
): MissedFlowContext {
  const clickedAtMs = Date.parse(request.clickedAt);
  const captureEndsAtMs = Date.parse(request.captureEndsAt);
  const turnsAtClick = session.transcripts.filter(
    (turn) => turn.sequence <= request.clickedAtSequence,
  );
  const timedLookback = turnsAtClick.filter((turn) => {
    const receivedAt = Date.parse(turn.receivedAt);
    return Number.isFinite(receivedAt) && receivedAt >= clickedAtMs - LOOKBACK_MS;
  });
  const beforeTurns = (timedLookback.length > 0 ? timedLookback : turnsAtClick.slice(-12))
    .map((turn) => structuredClone(turn));
  const buttonPoint = turnsAtClick.at(-1) ?? null;
  const afterTurns = session.transcripts
    .filter((turn) => {
      if (turn.sequence <= request.clickedAtSequence) return false;
      const receivedAt = Date.parse(turn.receivedAt);
      return !Number.isFinite(receivedAt) || receivedAt <= captureEndsAtMs;
    })
    .map((turn) => structuredClone(turn));
  const notes = [
    session.noteGeneration.finalNote,
    session.noteGeneration.currentNote,
    ...session.lectureNotes,
  ].filter((note): note is LectureNote => note !== null);

  return {
    requestId: request.id,
    clickedAt: request.clickedAt,
    clickedAtSequence: request.clickedAtSequence,
    captureEndsAt: request.captureEndsAt,
    beforeTurns,
    buttonPoint: buttonPoint ? structuredClone(buttonPoint) : null,
    afterTurns,
    materialKnowledge: structuredClone(session.materialKnowledge),
    slideMap: structuredClone(session.slideMap),
    currentStructuredNotes: Array.from(
      new Map(notes.map((note) => [note.id, note])).values(),
    ).map((note) => structuredClone(note)),
    currentLiveNotes: session.liveNotes.map((note) => structuredClone(note)),
    currentSlidePage: session.currentSlidePage,
  };
}
