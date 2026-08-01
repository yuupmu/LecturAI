import { randomUUID } from "node:crypto";
import type { LectureSession, SlideMap } from "./schemas";

// The demo store survives Next.js hot module reloads inside the same process.
declare global {
  var lecturAISessions: Map<string, LectureSession> | undefined;
}

const sessions =
  globalThis.lecturAISessions ??
  (globalThis.lecturAISessions = new Map<string, LectureSession>());

function emptySlideMap(language: string): SlideMap {
  return {
    documentTitle: "",
    documentSummary: "",
    language,
    globalKeywords: [],
    slides: [],
  };
}

export function createPreparingSession(
  instruction: string,
  language: string,
): LectureSession {
  const now = new Date().toISOString();
  const session: LectureSession = {
    id: randomUUID(),
    version: 1,
    status: "preparing",
    instruction,
    language,
    slideMap: emptySlideMap(language),
    currentSlidePage: null,
    transcripts: [],
    events: [],
    review: null,
    rawLogs: [],
    createdAt: now,
    updatedAt: now,
    processedItemIds: new Set<string>(),
    eventKeys: new Set<string>(),
    analysisChain: Promise.resolve(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): LectureSession | undefined {
  return sessions.get(sessionId);
}

export function requireSession(sessionId: string): LectureSession {
  const session = getSession(sessionId);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  return session;
}

export function touchSession(session: LectureSession): void {
  session.version += 1;
  session.updatedAt = new Date().toISOString();
}

export function makeSessionReady(
  session: LectureSession,
  slideMap: SlideMap,
): void {
  session.slideMap = slideMap;
  session.currentSlidePage = slideMap.slides[0]?.page ?? null;
  session.status = "ready";
  touchSession(session);
}

export function markSessionError(session: LectureSession): void {
  session.status = "error";
  touchSession(session);
}

export async function resetSession(session: LectureSession): Promise<void> {
  await session.analysisChain.catch(() => undefined);
  session.currentSlidePage = session.slideMap.slides[0]?.page ?? null;
  session.transcripts = [];
  session.events = [];
  session.review = null;
  session.rawLogs = [];
  session.processedItemIds = new Set<string>();
  session.eventKeys = new Set<string>();
  session.analysisChain = Promise.resolve();
  session.status = "ready";
  touchSession(session);
}

export function publicSessionState(session: LectureSession) {
  return {
    sessionId: session.id,
    version: session.version,
    status: session.status,
    currentSlidePage: session.currentSlidePage,
    slideMap: session.slideMap,
    transcripts: session.transcripts,
    events: session.events,
    review: session.review,
  };
}
