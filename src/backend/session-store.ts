import { randomUUID } from "node:crypto";
import {
  LectureQuestionSchema,
  LiveTranslationSegmentSchema,
} from "./schemas";
import type {
  LectureActivityState,
  EmphasisEvent,
  LectureMemory,
  NoteGenerationState,
  LectureSession,
  MaterialKnowledge,
  SlideMap,
  TranslationSettings,
} from "./schemas";

export const AUTOMATIC_NOTE_INTERVAL_SECONDS = 120;

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

export function createEmptyLectureMemory(): LectureMemory {
  return {
    revision: 0,
    currentUnit: null,
    completedUnits: [],
    recentTopicSummary: "",
  };
}

function emptyMaterialKnowledge(): MaterialKnowledge {
  return { title: "", summary: "", outline: [], terminology: [] };
}

function createTranslationSettingsState(revision = 0): TranslationSettings {
  return {
    enabled: false,
    targetLanguage: null,
    revision,
    updatedAt: Date.now(),
  };
}

export function createNoteGenerationState(
): NoteGenerationState {
  return {
    enabled: true,
    intervalSeconds: AUTOMATIC_NOTE_INTERVAL_SECONDS,
    status: "idle",
    revision: 0,
    lastProcessedSequence: 0,
    processedItemIds: [],
    lastGeneratedAt: null,
    nextScheduledAt: null,
    activeJobId: null,
    activeTrigger: null,
    pendingManualRequest: false,
    lastError: null,
    currentNote: null,
    finalNote: null,
  };
}

export function createLectureActivityState(): LectureActivityState {
  return {
    currentActivity: "silence",
    monitoringStartedAt: null,
    lastSpeechAt: null,
    lastMeaningfulInstructionAt: null,
    endingCandidate: null,
    inactivityCandidate: null,
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
    materialKnowledge: emptyMaterialKnowledge(),
    slideMap: emptySlideMap(language),
    currentSlidePage: null,
    slideResolution: null,
    pendingSlideCandidate: null,
    transcripts: [],
    translationSettings: createTranslationSettingsState(),
    translations: [],
    translationChain: Promise.resolve(),
    processedTranslationKeys: new Set<string>(),
    lectureMemory: createEmptyLectureMemory(),
    lectureNotes: [],
    noteGeneratingUnitIds: new Set<string>(),
    noteGeneration: createNoteGenerationState(),
    noteGenerationChain: Promise.resolve(),
    noteGenerationTimer: null,
    noteGenerationEpoch: 0,
    finalizationChain: Promise.resolve(),
    lectureRevision: 0,
    questions: [],
    questionChain: Promise.resolve(),
    questionEpoch: 0,
    professorStyleProfile: null,
    professorStyleChain: Promise.resolve(),
    professorStyleEpoch: 0,
    professorStyleLastProcessedSequence: 0,
    professorStyleQueuedThroughSequence: 0,
    absenceSpans: [],
    absenceSummaryChain: Promise.resolve(),
    absenceEpoch: 0,
    missedFlowRequests: [],
    missedFlowChain: Promise.resolve(),
    missedFlowEpoch: 0,
    understandingBranches: [],
    understandingBranchChain: Promise.resolve(),
    understandingBranchEpoch: 0,
    deferredQuestions: [],
    deferredQuestionChain: Promise.resolve(),
    deferredQuestionEpoch: 0,
    activityState: createLectureActivityState(),
    activityTimer: null,
    activityEpoch: 0,
    assistantRequests: [],
    assistantChain: Promise.resolve(),
    assistantEpoch: 0,
    liveNotes: [],
    events: [],
    review: null,
    rawLogs: [],
    createdAt: now,
    updatedAt: now,
    processedItemIds: new Set<string>(),
    eventKeys: new Set<string>(),
    analysisChain: Promise.resolve(),
    interpreterChain: Promise.resolve(),
    noteCompositionChain: Promise.resolve(),
    noteUpdateChain: Promise.resolve(),
    pendingNoteSequences: [],
    lastNoteUpdateAt: Date.now(),
    noteUpdateTimer: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): LectureSession | undefined {
  const session = sessions.get(sessionId);
  if (session) ensureCurrentSessionShape(session);
  return session;
}

// Adds fields introduced during demo hot reloads without discarding live sessions.
function ensureCurrentSessionShape(session: LectureSession): void {
  session.materialKnowledge ??= emptyMaterialKnowledge();
  session.translationSettings ??= createTranslationSettingsState();
  session.translations ??= [];
  session.translations = session.translations.map((segment) =>
    LiveTranslationSegmentSchema.parse(segment)
  );
  session.translationChain ??= Promise.resolve();
  session.processedTranslationKeys ??= new Set<string>();
  session.lectureMemory ??= createEmptyLectureMemory();
  session.lectureNotes ??= [];
  session.noteGeneratingUnitIds ??= new Set<string>();
  session.noteGeneration ??= createNoteGenerationState();
  session.noteGeneration.enabled = true;
  session.noteGeneration.intervalSeconds = AUTOMATIC_NOTE_INTERVAL_SECONDS;
  session.noteGeneration.processedItemIds ??= session.transcripts
    .filter(
      (transcript) =>
        transcript.sequence <= session.noteGeneration.lastProcessedSequence,
    )
    .map((transcript) => transcript.itemId);
  session.noteGenerationChain ??= Promise.resolve();
  session.noteGenerationTimer ??= null;
  session.noteGenerationEpoch ??= 0;
  session.finalizationChain ??= Promise.resolve();
  session.lectureRevision ??= session.transcripts.length;
  session.questions ??= [];
  session.questions = session.questions.map((question) =>
    LectureQuestionSchema.parse(question)
  );
  session.questionChain ??= Promise.resolve();
  session.questionEpoch ??= 0;
  session.professorStyleProfile ??= null;
  session.professorStyleChain ??= Promise.resolve();
  session.professorStyleEpoch ??= 0;
  session.professorStyleLastProcessedSequence ??= 0;
  session.professorStyleQueuedThroughSequence ??=
    session.professorStyleLastProcessedSequence;
  session.absenceSpans ??= [];
  session.absenceSummaryChain ??= Promise.resolve();
  session.absenceEpoch ??= 0;
  session.missedFlowRequests ??= [];
  session.missedFlowChain ??= Promise.resolve();
  session.missedFlowEpoch ??= 0;
  session.understandingBranches ??= [];
  session.understandingBranchChain ??= Promise.resolve();
  session.understandingBranchEpoch ??= 0;
  session.deferredQuestions ??= [];
  session.deferredQuestionChain ??= Promise.resolve();
  session.deferredQuestionEpoch ??= 0;
  session.activityState ??= createLectureActivityState();
  session.activityTimer ??= null;
  session.activityEpoch ??= 0;
  session.assistantRequests ??= [];
  session.assistantChain ??= Promise.resolve();
  session.assistantEpoch ??= 0;
  session.interpreterChain ??= Promise.resolve();
  session.noteCompositionChain ??= Promise.resolve();
  session.slideResolution ??= session.currentSlidePage === null
    ? null
    : {
        page: session.currentSlidePage,
        confidence: 0,
        reason: "기존 세션의 현재 페이지를 유지합니다.",
        changed: false,
        method: "kept_current",
      };
  session.pendingSlideCandidate ??= null;
  session.liveNotes ??= [];
  session.noteUpdateChain ??= Promise.resolve();
  session.pendingNoteSequences ??= [];
  session.lastNoteUpdateAt ??= Date.now();
  session.noteUpdateTimer ??= null;
  session.events = session.events.map((event) => {
    if (event.type !== "emphasis") return event;
    const legacy = event as Partial<EmphasisEvent> & {
      id: string;
      type: "emphasis";
      quote: string;
      concept: string;
      createdAt: string;
    };
    return {
      ...event,
      status: legacy.status ?? "complete",
      resolvedConcept: legacy.resolvedConcept ?? legacy.concept,
      emphasisKind: legacy.emphasisKind ?? "must_remember",
      evidenceType: legacy.evidenceType ?? "explicit_phrase",
      confidence: legacy.confidence ?? 0.9,
      reason: legacy.reason ?? "기존 명시적 강조 이벤트입니다.",
      slidePage: legacy.slidePage ?? session.currentSlidePage,
      sourceSequences: legacy.sourceSequences ?? [],
    } satisfies EmphasisEvent;
  });
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
  materialKnowledge: MaterialKnowledge = emptyMaterialKnowledge(),
): void {
  session.slideMap = slideMap;
  session.materialKnowledge = materialKnowledge;
  session.currentSlidePage = slideMap.slides[0]?.page ?? null;
  session.slideResolution = session.currentSlidePage === null
    ? null
    : {
        page: session.currentSlidePage,
        confidence: 1,
        reason: "첫 슬라이드에서 강의 문맥을 시작합니다.",
        changed: false,
        method: "kept_current",
      };
  session.status = "ready";
  touchSession(session);
}

export function markSessionError(session: LectureSession): void {
  session.status = "error";
  touchSession(session);
}

export async function resetSession(session: LectureSession): Promise<void> {
  session.noteGenerationEpoch += 1;
  session.assistantEpoch += 1;
  session.questionEpoch += 1;
  session.professorStyleEpoch += 1;
  session.absenceEpoch += 1;
  session.missedFlowEpoch += 1;
  session.understandingBranchEpoch += 1;
  session.deferredQuestionEpoch += 1;
  session.activityEpoch += 1;
  if (session.noteGenerationTimer) clearTimeout(session.noteGenerationTimer);
  session.noteGenerationTimer = null;
  if (session.activityTimer) clearTimeout(session.activityTimer);
  session.activityTimer = null;
  if (session.noteUpdateTimer) clearTimeout(session.noteUpdateTimer);
  session.noteUpdateTimer = null;
  await session.analysisChain.catch(() => undefined);
  await session.interpreterChain.catch(() => undefined);
  if (session.noteUpdateTimer) clearTimeout(session.noteUpdateTimer);
  session.noteUpdateTimer = null;
  await session.noteUpdateChain.catch(() => undefined);
  await session.noteCompositionChain.catch(() => undefined);
  session.currentSlidePage = session.slideMap.slides[0]?.page ?? null;
  session.slideResolution = session.currentSlidePage === null
    ? null
    : {
        page: session.currentSlidePage,
        confidence: 1,
        reason: "세션을 초기화해 첫 슬라이드로 돌아왔습니다.",
        changed: false,
        method: "kept_current",
      };
  session.pendingSlideCandidate = null;
  session.transcripts = [];
  session.translationSettings = createTranslationSettingsState(
    session.translationSettings.revision + 1,
  );
  session.translations = [];
  session.translationChain = Promise.resolve();
  session.processedTranslationKeys = new Set<string>();
  session.lectureMemory = createEmptyLectureMemory();
  session.lectureNotes = [];
  session.noteGeneratingUnitIds = new Set<string>();
  session.noteGeneration = createNoteGenerationState();
  session.noteGenerationChain = Promise.resolve();
  session.finalizationChain = Promise.resolve();
  session.lectureRevision = 0;
  session.questions = [];
  session.questionChain = Promise.resolve();
  session.professorStyleProfile = null;
  session.professorStyleChain = Promise.resolve();
  session.professorStyleLastProcessedSequence = 0;
  session.professorStyleQueuedThroughSequence = 0;
  session.absenceSpans = [];
  session.absenceSummaryChain = Promise.resolve();
  session.missedFlowRequests = [];
  session.missedFlowChain = Promise.resolve();
  session.understandingBranches = [];
  session.understandingBranchChain = Promise.resolve();
  session.deferredQuestions = [];
  session.deferredQuestionChain = Promise.resolve();
  session.activityState = createLectureActivityState();
  session.assistantRequests = [];
  session.assistantChain = Promise.resolve();
  session.liveNotes = [];
  session.events = [];
  session.review = null;
  session.rawLogs = [];
  session.processedItemIds = new Set<string>();
  session.eventKeys = new Set<string>();
  session.analysisChain = Promise.resolve();
  session.interpreterChain = Promise.resolve();
  session.noteCompositionChain = Promise.resolve();
  session.noteUpdateChain = Promise.resolve();
  session.pendingNoteSequences = [];
  session.lastNoteUpdateAt = Date.now();
  session.noteUpdateTimer = null;
  session.status = "ready";
  touchSession(session);
}

export function publicSessionState(session: LectureSession) {
  return {
    sessionId: session.id,
    version: session.version,
    status: session.status,
    currentSlidePage: session.currentSlidePage,
    slideResolution: session.slideResolution,
    slideMap: session.slideMap,
    materialKnowledge: session.materialKnowledge,
    transcripts: session.transcripts,
    translationSettings: session.translationSettings,
    translations: session.translations,
    lectureMemory: session.lectureMemory,
    lectureNotes: session.lectureNotes,
    noteGeneratingUnitIds: Array.from(session.noteGeneratingUnitIds),
    noteGeneration: session.noteGeneration,
    lectureRevision: session.lectureRevision,
    questions: session.questions,
    professorStyleProfile: session.professorStyleProfile,
    absenceSpans: session.absenceSpans,
    missedFlowRequests: session.missedFlowRequests,
    understandingBranches: session.understandingBranches,
    deferredQuestions: session.deferredQuestions,
    activityState: session.activityState,
    assistantRequests: session.assistantRequests,
    liveNotes: session.liveNotes,
    events: session.events,
    review: session.review,
  };
}
