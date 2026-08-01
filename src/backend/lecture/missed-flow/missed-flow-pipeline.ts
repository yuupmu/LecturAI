import { randomUUID } from "node:crypto";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  MissedFlowRecoverySchema,
  MissedFlowRequestSchema,
  type LectureSession,
  type MissedFlowRecovery,
  type MissedFlowRecoveryDraft,
  type MissedFlowRequest,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  buildMissedFlowContext,
  type MissedFlowContext,
} from "./build-missed-flow-context";
import {
  generateMissedFlowRecovery,
  type MissedFlowComposer,
} from "./generate-missed-flow-recovery";

export const MISSED_FLOW_CAPTURE_MS = 15_000;

export interface MissedFlowDependencies {
  compose: MissedFlowComposer;
  captureMs: number;
}

const defaultDependencies: MissedFlowDependencies = {
  compose: generateMissedFlowRecovery,
  captureMs: MISSED_FLOW_CAPTURE_MS,
};

export interface MissedFlowRequestResult {
  accepted: boolean;
  request: MissedFlowRequest;
  message: string;
}

export function createMissedFlowRequest(
  session: LectureSession,
  dependencies: MissedFlowDependencies = defaultDependencies,
): MissedFlowRequestResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_MISSED_FLOW");
  }
  const active = session.missedFlowRequests.find(
    (request) => request.status === "capturing" || request.status === "generating",
  );
  if (active) {
    return {
      accepted: false,
      request: active,
      message: "이미 방금 놓친 흐름을 복구하고 있습니다.",
    };
  }

  const clickedAtMs = Date.now();
  const request = MissedFlowRequestSchema.parse({
    id: randomUUID(),
    sessionId: session.id,
    status: "capturing",
    clickedAt: new Date(clickedAtMs).toISOString(),
    captureEndsAt: new Date(clickedAtMs + dependencies.captureMs).toISOString(),
    clickedAtSequence: session.transcripts.at(-1)?.sequence ?? 0,
    capturedThroughSequence: null,
    recovery: null,
    errorMessage: null,
  });
  session.missedFlowRequests.push(request);
  const epoch = session.missedFlowEpoch;
  touchSession(session);
  appendRawLog(session, "system", "missed_flow_requested", {
    sessionId: session.id,
    requestId: request.id,
    sourceItemIds: [],
    durationMs: 0,
    reason: "learner_lost_thread",
  });

  setTimeout(() => {
    if (session.missedFlowEpoch !== epoch) return;
    session.missedFlowChain = session.missedFlowChain
      .catch(() => undefined)
      .then(() => runMissedFlowJob(session, request.id, epoch, dependencies.compose))
      .catch((error) => {
        recordSessionError(session, "missed_flow_chain", error, {
          requestId: request.id,
        });
      });
  }, dependencies.captureMs);

  return {
    accepted: true,
    request,
    message: "이 지점을 기억했습니다. 이어지는 설명까지 듣고 흐름을 복구합니다.",
  };
}

async function runMissedFlowJob(
  session: LectureSession,
  requestId: string,
  epoch: number,
  compose: MissedFlowComposer,
): Promise<void> {
  if (session.missedFlowEpoch !== epoch) return;
  const request = session.missedFlowRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "capturing") return;

  request.status = "generating";
  request.capturedThroughSequence = session.transcripts.at(-1)?.sequence ??
    request.clickedAtSequence;
  touchSession(session);
  const context = buildMissedFlowContext(session, request);
  const startedAt = Date.now();

  try {
    const draft = await compose(context);
    assertCurrent(session, requestId, epoch);
    request.recovery = sanitizeRecovery(context, draft, false);
    request.status = "completed";
    request.errorMessage = null;
    touchSession(session);
    appendRawLog(session, "system", "missed_flow_completed", {
      sessionId: session.id,
      requestId,
      sourceItemIds: request.recovery.sourceItemIds,
      durationMs: Date.now() - startedAt,
      reason: "recovery_card_ready",
    });
  } catch (error) {
    if (session.missedFlowEpoch !== epoch) return;
    const current = session.missedFlowRequests.find((item) => item.id === requestId);
    if (!current) return;
    current.recovery = fallbackMissedFlowRecovery(context);
    current.status = "completed";
    current.errorMessage = "AI 복구에 실패해 현재 대본과 필기 기반으로 표시합니다.";
    touchSession(session);
    recordSessionError(session, "missed_flow_generation", error, { requestId });
  }
}

function sanitizeRecovery(
  context: MissedFlowContext,
  draft: MissedFlowRecoveryDraft,
  fallback: boolean,
): MissedFlowRecovery {
  const turns = [...context.beforeTurns, ...context.afterTurns];
  const allowedItems = new Set(turns.map((turn) => turn.itemId));
  const allowedPages = new Set([
    ...context.slideMap.slides.map((slide) => slide.page),
    ...turns.flatMap((turn) => turn.matchedSlidePages),
  ]);
  return MissedFlowRecoverySchema.parse({
    ...draft,
    sourceItemIds: Array.from(new Set(
      draft.sourceItemIds.filter((id) => allowedItems.has(id)),
    )),
    sourcePages: Array.from(new Set(
      draft.sourcePages.filter((page) => allowedPages.has(page)),
    )),
    generatedAt: new Date().toISOString(),
    fallback,
  });
}

export function fallbackMissedFlowRecovery(
  context: MissedFlowContext,
): MissedFlowRecovery {
  const before = context.beforeTurns.at(-1)?.text.trim();
  const after = context.afterTurns[0]?.text.trim();
  const noteIdea = context.currentLiveNotes.at(-1)?.bullets.at(-1)?.text ??
    context.currentStructuredNotes.at(-1)?.sections.at(-1)?.items.at(-1)?.text ??
    context.materialKnowledge.outline.at(-1)?.summary;
  const idea = noteIdea || before || "버튼 직전 설명과 현재 문장의 연결";
  const sourceTurns = [...context.beforeTurns, ...context.afterTurns];

  return sanitizeRecovery(context, {
    whatCameBefore: before
      ? `버튼 직전에는 “${before}”라는 내용을 설명하고 있었습니다.`
      : "버튼 직전의 확정 대본이 없어 앞 설명을 특정하기 어렵습니다.",
    whyThisCameNext: after
      ? `이어서 “${after}”라는 설명으로 넘어갔습니다. 직전 내용과의 연결을 중심으로 들으세요.`
      : "아직 후속 발화가 충분히 기록되지 않아 다음 문장의 이유를 특정하기 어렵습니다.",
    requiredIdea: idea,
    resumeWith: `“${idea}”를 중심으로 지금 설명을 이어 들으면 됩니다.`,
    sourceItemIds: sourceTurns.map((turn) => turn.itemId),
    sourcePages: Array.from(new Set(sourceTurns.flatMap((turn) => turn.matchedSlidePages))),
  }, true);
}

// Finalization must not leave a card permanently stuck in "capturing" if the
// lecture ends during the short post-click listening window.
export function completePendingMissedFlowsWithFallback(
  session: LectureSession,
): void {
  const pending = session.missedFlowRequests.filter(
    (request) => request.status === "capturing" || request.status === "generating",
  );
  if (pending.length === 0) return;
  session.missedFlowEpoch += 1;
  for (const request of pending) {
    request.capturedThroughSequence = session.transcripts.at(-1)?.sequence ??
      request.clickedAtSequence;
    request.recovery = fallbackMissedFlowRecovery(
      buildMissedFlowContext(session, request),
    );
    request.status = "completed";
    request.errorMessage = "수업이 종료되어 현재까지의 대본과 필기로 복구했습니다.";
  }
  touchSession(session);
}

function assertCurrent(
  session: LectureSession,
  requestId: string,
  epoch: number,
): void {
  if (
    session.missedFlowEpoch !== epoch ||
    !session.missedFlowRequests.some((request) => request.id === requestId)
  ) throw new Error("MISSED_FLOW_JOB_STALE");
}
