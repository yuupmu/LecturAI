import {
  getExplicitEndingGraceSeconds,
  getInactivityGraceSeconds,
  getInactivitySeconds,
} from "../../env";
import { appendRawLog } from "../../logs/raw-log";
import { startAutomaticNoteSchedule } from "../notes/cumulative-note-pipeline";
import type {
  LectureActivity,
  LectureSession,
  Transcript,
} from "../../schemas";
import { touchSession } from "../../session-store";

export interface LectureActivityOptions {
  explicitGraceSeconds?: number;
  inactivitySeconds?: number;
  inactivityGraceSeconds?: number;
  finalize?: (session: LectureSession) => Promise<void>;
}

export interface CancelEndingResult {
  accepted: boolean;
  message: string;
}

export function processLectureActivity(
  session: LectureSession,
  transcript: Transcript,
  options: LectureActivityOptions = {},
): LectureActivity {
  if (session.status === "finalizing" || session.status === "ended") {
    return session.activityState.currentActivity;
  }
  const now = new Date();
  const state = session.activityState;
  state.monitoringStartedAt ??= now.toISOString();
  state.lastSpeechAt = now.toISOString();

  const baseActivity = classifyLectureActivity(transcript.text);
  const baseMeaningful = isMeaningfulActivity(baseActivity, transcript.text);
  const hadCandidate = state.endingCandidate !== null;
  if (hadCandidate && (baseMeaningful || isEndingWithdrawal(transcript.text))) {
    cancelCandidateInternal(
      session,
      baseMeaningful ? "new_instructional_content" : "ending_withdrawn_by_followup",
      false,
    );
  }
  const ending = hadCandidate && baseMeaningful
    ? { detected: false, sourceItemIds: [], reason: "candidate_cancelled_by_instruction" }
    : detectExplicitEnding(session);
  const activity = ending.detected ? "ending" : baseActivity;
  const meaningful = isMeaningfulActivity(activity, transcript.text);

  state.currentActivity = activity;
  if (meaningful) state.lastMeaningfulInstructionAt = now.toISOString();
  appendRawLog(session, "system", "lecture_activity_updated", {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    questionId: null,
    absenceSpanId: activeAbsenceId(session),
    sourceItemIds: [transcript.itemId],
    durationMs: 0,
    reason: activity,
  });

  if (ending.detected) {
    createExplicitEndingCandidate(
      session,
      ending.sourceItemIds,
      ending.reason,
      options,
    );
  } else if (!state.endingCandidate) {
    scheduleInactivityMonitor(session, options);
  }
  touchSession(session);
  return activity;
}

export function classifyLectureActivity(text: string): LectureActivity {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) return "silence";
  if (/(잠시\s*쉬|쉬는\s*시간|휴식|브레이크|쉬었다가|잠깐\s*멈)/u.test(normalized)) {
    return "break";
  }
  if (/(출석|마이크|화면\s*(공유|보이)|소리\s*(들리|안\s*들)|기기|과제\s*제출|공지|조별|강의실)/u.test(normalized)) {
    return "class_administration";
  }
  if (/(잡담|오늘\s*점심|점심\s*메뉴|날씨|주말에|드라마|축구\s*경기|맛집|휴가|여행\s*다녀)/u.test(normalized)) {
    return "off_topic";
  }
  if (/(예를\s*들|예시|가령|비유하|생각해\s*보)/u.test(normalized)) {
    return "example";
  }
  if (/[?？]/u.test(normalized) || /(왜일까요|어떻게\s*될까요|무엇일까요|기억나나요)/u.test(normalized)) {
    return /^(질문|궁금|쉬었다|출석|소리|화면)/u.test(normalized)
      ? "class_administration"
      : "class_question";
  }
  if (normalized.length < 8 || /^(네|예|음|어|자|좋아요|안녕하세요|그렇죠)[.!?\s]*$/u.test(normalized)) {
    return "off_topic";
  }
  return "instruction";
}

export function createExplicitEndingCandidate(
  session: LectureSession,
  sourceItemIds: string[],
  reason: string,
  options: LectureActivityOptions = {},
): void {
  if (session.status === "finalizing" || session.status === "ended") return;
  const now = Date.now();
  const graceSeconds = options.explicitGraceSeconds ?? getExplicitEndingGraceSeconds();
  clearActivityTimer(session);
  session.activityState.endingCandidate = {
    kind: "explicit",
    detectedAt: new Date(now).toISOString(),
    sourceItemIds: Array.from(new Set(sourceItemIds)),
    reason,
    expiresAt: new Date(now + graceSeconds * 1_000).toISOString(),
  };
  session.activityState.inactivityCandidate = null;
  session.status = "ending_candidate";
  touchSession(session);
  appendRawLog(session, "system", "explicit_ending_candidate", {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    questionId: null,
    absenceSpanId: activeAbsenceId(session),
    sourceItemIds,
    durationMs: 0,
    reason,
  });
  scheduleCandidateFinalization(session, graceSeconds, options);
}

export function cancelEndingCandidate(
  session: LectureSession,
): CancelEndingResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_ENDING_NOT_CANCELLABLE");
  }
  if (!session.activityState.endingCandidate) {
    return { accepted: false, message: "취소할 수업 종료 후보가 없습니다." };
  }
  cancelCandidateInternal(session, "user_continue_listening", true);
  return { accepted: true, message: "자동 종료를 취소하고 수업을 계속 듣습니다." };
}

export function clearActivityTimer(session: LectureSession): void {
  session.activityEpoch += 1;
  if (session.activityTimer) clearTimeout(session.activityTimer);
  session.activityTimer = null;
}

export function resumeInactivityMonitor(
  session: LectureSession,
  options: LectureActivityOptions = {},
): void {
  if (!activeAbsenceId(session) && !session.activityState.endingCandidate) {
    scheduleInactivityMonitor(session, options);
  }
}

function scheduleInactivityMonitor(
  session: LectureSession,
  options: LectureActivityOptions,
): void {
  if (
    session.status === "finalizing" ||
    session.status === "ended" ||
    session.activityState.endingCandidate
  ) return;
  if (session.activityTimer) clearTimeout(session.activityTimer);
  session.activityEpoch += 1;
  const epoch = session.activityEpoch;
  const inactivitySeconds = options.inactivitySeconds ?? getInactivitySeconds();
  const baseline = session.activityState.lastMeaningfulInstructionAt ??
    session.activityState.monitoringStartedAt ??
    new Date().toISOString();
  const remainingMs = Math.max(
    0,
    new Date(baseline).getTime() + inactivitySeconds * 1_000 - Date.now(),
  );
  session.activityTimer = setTimeout(() => {
    session.activityTimer = null;
    if (
      session.activityEpoch !== epoch ||
      session.status === "finalizing" ||
      session.status === "ended" ||
      session.activityState.endingCandidate
    ) return;
    if (activeAbsenceId(session)) {
      scheduleSuppressedInactivityCheck(session, options);
      return;
    }
    createInactivityCandidate(session, baseline, options);
  }, remainingMs);
  session.activityTimer.unref?.();
}

function scheduleSuppressedInactivityCheck(
  session: LectureSession,
  options: LectureActivityOptions,
): void {
  session.activityEpoch += 1;
  const epoch = session.activityEpoch;
  const delaySeconds = Math.min(options.inactivitySeconds ?? getInactivitySeconds(), 60);
  session.activityTimer = setTimeout(() => {
    session.activityTimer = null;
    if (session.activityEpoch !== epoch) return;
    if (activeAbsenceId(session)) {
      scheduleSuppressedInactivityCheck(session, options);
    } else {
      scheduleInactivityMonitor(session, options);
    }
  }, delaySeconds * 1_000);
  session.activityTimer.unref?.();
}

function createInactivityCandidate(
  session: LectureSession,
  baseline: string,
  options: LectureActivityOptions,
): void {
  const now = Date.now();
  const graceSeconds = options.inactivityGraceSeconds ?? getInactivityGraceSeconds();
  session.activityState.endingCandidate = {
    kind: "inactivity",
    detectedAt: new Date(now).toISOString(),
    sourceItemIds: [],
    reason: "meaningful_instruction_inactive",
    expiresAt: new Date(now + graceSeconds * 1_000).toISOString(),
  };
  session.activityState.inactivityCandidate = {
    detectedAt: new Date(now).toISOString(),
    lastMeaningfulInstructionAt: baseline,
    expiresAt: new Date(now + graceSeconds * 1_000).toISOString(),
  };
  session.status = "inactivity_candidate";
  touchSession(session);
  appendRawLog(session, "system", "inactivity_ending_candidate", {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    questionId: null,
    absenceSpanId: null,
    sourceItemIds: [],
    durationMs: 0,
    reason: "no_meaningful_instruction_within_threshold",
  });
  scheduleCandidateFinalization(session, graceSeconds, options);
}

function scheduleCandidateFinalization(
  session: LectureSession,
  graceSeconds: number,
  options: LectureActivityOptions,
): void {
  session.activityEpoch += 1;
  const epoch = session.activityEpoch;
  session.activityTimer = setTimeout(() => {
    session.activityTimer = null;
    if (
      session.activityEpoch !== epoch ||
      !session.activityState.endingCandidate ||
      (session.status !== "ending_candidate" && session.status !== "inactivity_candidate")
    ) return;
    const finalize = options.finalize ?? defaultFinalize;
    void finalize(session);
  }, graceSeconds * 1_000);
  session.activityTimer.unref?.();
}

async function defaultFinalize(session: LectureSession): Promise<void> {
  const { finalizeLectureSession } = await import("../notes/finalize-lecture-session");
  await finalizeLectureSession(session);
}

function cancelCandidateInternal(
  session: LectureSession,
  reason: string,
  resetInactivityWindow: boolean,
): void {
  const candidate = session.activityState.endingCandidate;
  clearActivityTimer(session);
  session.activityState.endingCandidate = null;
  session.activityState.inactivityCandidate = null;
  if (resetInactivityWindow) {
    session.activityState.lastMeaningfulInstructionAt = new Date().toISOString();
  }
  session.status = "listening";
  touchSession(session);
  appendRawLog(session, "system", "ending_candidate_cancelled", {
    sessionId: session.id,
    lectureRevision: session.lectureRevision,
    questionId: null,
    absenceSpanId: activeAbsenceId(session),
    sourceItemIds: candidate?.sourceItemIds ?? [],
    durationMs: 0,
    reason,
  });
  scheduleInactivityMonitor(session, {});
  startAutomaticNoteSchedule(session);
}

function detectExplicitEnding(session: LectureSession): {
  detected: boolean;
  sourceItemIds: string[];
  reason: string;
} {
  const recent = session.transcripts.slice(-6);
  const combined = recent.map((turn) => turn.text).join(" ").normalize("NFKC");
  const hasEnding = /(오늘\s*(수업|강의)(?:은|를)?\s*(?:여기까지|마치|마무리)|이상으로\s*(?:수업|강의)?(?:을|를)?\s*마치|질문이\s*없다면\s*오늘(?:은)?\s*마무리|오늘\s*배울\s*내용(?:은|이)?\s*모두\s*끝|다음\s*시간에\s*이어(?:서)?\s*보)/u.test(combined);
  const guarded = /(라고\s*말하면|라는\s*문장|이\s*문장은|표현(?:입니다|이다)|예를\s*들어|가정하|아니(?:고|라)|아닙니다|아니다|않습니다|아직|마치기\s*전에|끝내기\s*전에|하나\s*더|문제(?:를)?\s*더|뒤에\s*.*더\s*있|쉬었다가|휴식|잠시\s*쉬|이어가겠습니다)/u.test(combined);
  return {
    detected: hasEnding && !guarded,
    sourceItemIds: hasEnding && !guarded ? recent.map((turn) => turn.itemId) : [],
    reason: hasEnding && !guarded
      ? "recent_context_contains_unqualified_explicit_ending"
      : guarded
        ? "ending_phrase_guarded_by_quote_negation_or_break"
        : "no_explicit_ending",
  };
}

function isMeaningfulActivity(activity: LectureActivity, text: string): boolean {
  if (activity === "instruction" || activity === "example") return true;
  return activity === "class_question" && !/(출석|소리|화면|과제|쉬는\s*시간)/u.test(text);
}

function isEndingWithdrawal(text: string): boolean {
  return /(아직|한\s*가지\s*더|하나\s*더|끝난\s*게\s*아니|이어(?:서)?\s*(?:보|하)|마치기\s*전에)/u.test(text);
}

function activeAbsenceId(session: LectureSession): string | null {
  return session.absenceSpans.find((span) => span.status === "active")?.id ?? null;
}
