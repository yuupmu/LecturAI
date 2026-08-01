import { randomUUID } from "node:crypto";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  StoredLectureAssistantAnswerSchema,
  TranscriptSelectionContextSchema,
  UnderstandingBranchMessageSchema,
  UnderstandingBranchSchema,
  UnderstandingRejoinPacketSchema,
  type LectureAssistantAnswer,
  type LectureAssistantModelAnswer,
  type LectureSession,
  type UnderstandingBranch,
  type UnderstandingBranchStartInput,
  type UnderstandingRejoinDraft,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  generateLectureAssistantAnswer,
  type LectureAssistantGenerator,
} from "../assistant/answer-lecture-question";
import { buildFullLectureContext } from "../assistant/build-full-lecture-context";
import { validateAssistantAnswer } from "../assistant/validate-assistant-answer";
import { validateQuestionTranscriptSelection } from "../questions/validate-transcript-selection";
import {
  generateUnderstandingRejoinPacket,
  type UnderstandingRejoinComposer,
  type UnderstandingRejoinContext,
} from "./generate-rejoin-packet";

export interface UnderstandingBranchDependencies {
  explain: LectureAssistantGenerator;
  composeRejoin: UnderstandingRejoinComposer;
}

const defaultDependencies: UnderstandingBranchDependencies = {
  explain: generateLectureAssistantAnswer,
  composeRejoin: generateUnderstandingRejoinPacket,
};

export interface UnderstandingBranchResult {
  accepted: boolean;
  branch: UnderstandingBranch;
  message: string;
}

export function startUnderstandingBranch(
  session: LectureSession,
  untrustedInput: UnderstandingBranchStartInput,
  dependencies: UnderstandingBranchDependencies = defaultDependencies,
): UnderstandingBranchResult {
  return startBranch(session, untrustedInput, "selection", dependencies);
}

export function startUnderstandingBranchFromDeferred(
  session: LectureSession,
  focusText: string,
  dependencies: UnderstandingBranchDependencies = defaultDependencies,
): UnderstandingBranchResult {
  return startBranch(
    session,
    { selection: undefined },
    "deferred_question",
    dependencies,
    focusText,
  );
}

function startBranch(
  session: LectureSession,
  input: UnderstandingBranchStartInput,
  requestedSource: "selection" | "deferred_question",
  dependencies: UnderstandingBranchDependencies,
  trustedFocusText?: string,
): UnderstandingBranchResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_UNDERSTANDING_BRANCH");
  }
  const existing = activeBranch(session);
  if (existing) {
    return {
      accepted: false,
      branch: existing,
      message: "이미 진행 중인 이해 분기가 있습니다.",
    };
  }
  const latest = session.transcripts.at(-1);
  if (!latest) throw new Error("UNDERSTANDING_BRANCH_NEEDS_TRANSCRIPT");
  const snapshotSequence = latest.sequence;
  const selection = input.selection
    ? validateQuestionTranscriptSelection(
        session,
        TranscriptSelectionContextSchema.parse(input.selection),
        snapshotSequence,
      )
    : null;
  const focusText = trustedFocusText ?? selection?.selectedText ?? latest.text;
  const now = new Date().toISOString();
  const branch = UnderstandingBranchSchema.parse({
    id: randomUUID(),
    sessionId: session.id,
    type: "immediate_understanding",
    startSource: requestedSource === "deferred_question"
      ? "deferred_question"
      : selection ? "selection" : "current_point",
    focusText,
    selection,
    startedAt: now,
    startedAtSequence: snapshotSequence,
    startedAtRevision: session.lectureRevision,
    endedAt: null,
    endedAtSequence: null,
    status: "active",
    explanationStatus: "answering",
    messageStatus: "answering",
    messages: [],
    rejoinPacket: null,
    errorMessage: null,
  });
  const context = buildFullLectureContext(session, {
    mode: selection ? "explain_selection" : "question",
    snapshotSequence,
    question: selection
      ? null
      : `이해가 끊긴 중심 내용은 다음과 같습니다. 쉬운 해석, 원리, 단계와 간단한 예시로 설명해 주세요.\n\n${focusText}`,
    selection,
  });
  const epoch = session.understandingBranchEpoch;
  session.understandingBranches.push(branch);
  touchSession(session);
  appendRawLog(session, "system", "understanding_branch_started", branchLog(
    session,
    branch,
    0,
    "full_transcript_snapshot_captured",
  ));

  enqueueBranchJob(session, branch.id, async () => {
    const answer = await dependencies.explain(context);
    publishBranchAnswer(session, branch.id, epoch, answer, true);
  });
  return {
    accepted: true,
    branch,
    message: "개인 보충 설명을 준비하고 있습니다. 실제 수업 기록은 계속됩니다.",
  };
}

export function addUnderstandingBranchMessage(
  session: LectureSession,
  branchId: string,
  message: string,
  dependencies: UnderstandingBranchDependencies = defaultDependencies,
): UnderstandingBranchResult {
  const branch = findBranch(session, branchId);
  if (!branch) throw new Error("UNDERSTANDING_BRANCH_NOT_FOUND");
  if (branch.status !== "active") throw new Error("UNDERSTANDING_BRANCH_NOT_ACTIVE");
  if (branch.messageStatus === "answering") {
    return { accepted: false, branch, message: "이전 설명을 준비하고 있습니다." };
  }
  const trimmed = message.trim();
  const userMessage = UnderstandingBranchMessageSchema.parse({
    id: randomUUID(),
    role: "user",
    content: trimmed,
    answer: null,
    createdAt: new Date().toISOString(),
  });
  const snapshotSequence = session.transcripts.at(-1)?.sequence ?? branch.startedAtSequence;
  const conversation = [...branch.messages, userMessage]
    .map((entry) => `${entry.role === "user" ? "학생" : "AI"}: ${entry.content}`)
    .join("\n");
  const context = buildFullLectureContext(session, {
    mode: "question",
    snapshotSequence,
    question: `개인 이해 분기의 중심 내용: ${branch.focusText}\n\n분기 대화:\n${conversation}\n\n마지막 학생 질문에 직접 답하세요.`,
    selection: null,
  });
  const epoch = session.understandingBranchEpoch;
  branch.messages.push(userMessage);
  branch.messageStatus = "answering";
  branch.errorMessage = null;
  touchSession(session);
  appendRawLog(session, "system", "understanding_branch_message", branchLog(
    session,
    branch,
    0,
    "student_follow_up_queued",
  ));
  enqueueBranchJob(session, branch.id, async () => {
    const answer = await dependencies.explain(context);
    publishBranchAnswer(session, branch.id, epoch, answer, false);
  });
  return { accepted: true, branch, message: "추가 질문을 맡았습니다." };
}

export function rejoinUnderstandingBranch(
  session: LectureSession,
  branchId: string,
  dependencies: UnderstandingBranchDependencies = defaultDependencies,
): UnderstandingBranchResult {
  const branch = findBranch(session, branchId);
  if (!branch) throw new Error("UNDERSTANDING_BRANCH_NOT_FOUND");
  if (branch.status === "rejoining" || branch.status === "completed") {
    return { accepted: false, branch, message: "이미 합류를 처리하고 있습니다." };
  }
  if (branch.status !== "active") throw new Error("UNDERSTANDING_BRANCH_NOT_ACTIVE");
  branch.status = "rejoining";
  branch.endedAt = new Date().toISOString();
  branch.endedAtSequence = session.transcripts.at(-1)?.sequence ?? branch.startedAtSequence;
  branch.errorMessage = null;
  const context = buildRejoinContext(session, branch);
  const epoch = session.understandingBranchEpoch;
  touchSession(session);
  appendRawLog(session, "system", "understanding_branch_rejoin_started", branchLog(
    session,
    branch,
    0,
    "rejoin_boundary_captured",
  ));
  enqueueBranchJob(session, branch.id, async () => {
    const startedAt = Date.now();
    try {
      const current = requireCurrentBranch(session, branch.id, epoch);
      context.branchMessages = structuredClone(current.messages);
      const draft = await dependencies.composeRejoin(context);
      const target = requireCurrentBranch(session, branch.id, epoch);
      target.rejoinPacket = publishRejoinPacket(context, draft, false);
      target.status = "completed";
      target.messageStatus = "idle";
      target.errorMessage = null;
      touchSession(session);
      appendRawLog(session, "system", "understanding_branch_rejoined", branchLog(
        session,
        target,
        Date.now() - startedAt,
        "rejoin_packet_published",
      ));
    } catch (error) {
      if (session.understandingBranchEpoch !== epoch) return;
      const target = findBranch(session, branch.id);
      if (!target) return;
      target.rejoinPacket = fallbackRejoinPacket(context);
      target.status = "completed";
      target.messageStatus = "idle";
      target.errorMessage = "AI 합류 요약에 실패해 원본 대본 기반 합류 정보를 표시합니다.";
      touchSession(session);
      appendRawLog(session, "error", "understanding_branch_failed", branchLog(
        session,
        target,
        Date.now() - startedAt,
        error instanceof Error ? error.message : "unknown_rejoin_error",
      ));
      recordSessionError(session, "understanding_branch_rejoin", error, {
        branchId: branch.id,
      });
    }
  });
  return { accepted: true, branch, message: "현재 수업과 연결할 내용을 정리하고 있습니다." };
}

function publishBranchAnswer(
  session: LectureSession,
  branchId: string,
  epoch: number,
  modelAnswer: LectureAssistantModelAnswer,
  initial: boolean,
): void {
  const branch = requireCurrentBranch(session, branchId, epoch);
  const snapshotSequence = session.transcripts.at(-1)?.sequence ?? branch.startedAtSequence;
  const validated = validateAssistantAnswer(session, branchId, snapshotSequence, modelAnswer);
  const answer: LectureAssistantAnswer = StoredLectureAssistantAnswerSchema.parse(validated);
  branch.messages.push(UnderstandingBranchMessageSchema.parse({
    id: randomUUID(),
    role: "assistant",
    content: [answer.directAnswer, answer.explanation].filter(Boolean).join("\n\n"),
    answer,
    createdAt: answer.answeredAt,
  }));
  branch.explanationStatus = "answered";
  branch.messageStatus = "idle";
  branch.errorMessage = null;
  touchSession(session);
  appendRawLog(session, "system", "understanding_branch_message", branchLog(
    session,
    branch,
    0,
    initial ? "initial_explanation_published" : "follow_up_published",
  ));
}

function enqueueBranchJob(
  session: LectureSession,
  branchId: string,
  job: () => Promise<void>,
): void {
  session.understandingBranchChain = session.understandingBranchChain
    .catch(() => undefined)
    .then(job)
    .catch((error) => {
      if (
        error instanceof Error &&
        error.message === "UNDERSTANDING_BRANCH_JOB_STALE"
      ) return;
      const branch = findBranch(session, branchId);
      if (branch && branch.status !== "completed") {
        branch.explanationStatus = "failed";
        branch.messageStatus = "idle";
        branch.errorMessage = "보충 설명을 생성하지 못했습니다. 다시 질문하거나 현재 수업으로 합류해 주세요.";
        touchSession(session);
        appendRawLog(session, "error", "understanding_branch_failed", branchLog(
          session,
          branch,
          0,
          error instanceof Error ? error.message : "unknown_branch_error",
        ));
      }
      recordSessionError(session, "understanding_branch_chain", error, { branchId });
    });
}

function buildRejoinContext(
  session: LectureSession,
  branch: UnderstandingBranch,
): UnderstandingRejoinContext {
  if (branch.endedAtSequence === null || branch.endedAt === null) {
    throw new Error("UNDERSTANDING_BRANCH_NOT_ENDED");
  }
  const through = branch.endedAtSequence;
  const fullTranscript = session.transcripts
    .filter((turn) => turn.sequence <= through)
    .map((turn) => structuredClone(turn));
  const elapsedTurns = fullTranscript.filter(
    (turn) => turn.sequence > branch.startedAtSequence,
  );
  const currentNote = session.noteGeneration.currentNote ??
    session.noteGeneration.finalNote ??
    [...session.lectureNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    null;
  return {
    branchId: branch.id,
    focusText: branch.focusText,
    startedAt: branch.startedAt,
    endedAt: branch.endedAt,
    startedAtSequence: branch.startedAtSequence,
    endedAtSequence: through,
    fullTranscript,
    elapsedTurns,
    branchMessages: structuredClone(branch.messages),
    materialKnowledge: hasMaterial(session) ? structuredClone(session.materialKnowledge) : null,
    currentNote: currentNote ? structuredClone(currentNote) : null,
    knownCurrentLecturePosition: currentNote?.sections.at(-1)?.heading ??
      session.lectureMemory.currentUnit?.workingTitle ??
      fullTranscript.at(-1)?.text ??
      "합류 시점의 새 발화가 없습니다.",
  };
}

function publishRejoinPacket(
  context: UnderstandingRejoinContext,
  draft: UnderstandingRejoinDraft,
  fallback: boolean,
) {
  const allowed = new Set(context.elapsedTurns.map((turn) => turn.itemId));
  return UnderstandingRejoinPacketSchema.parse({
    ...draft,
    sourceItemIds: Array.from(new Set(draft.sourceItemIds.filter((id) => allowed.has(id)))),
    rawTranscript: context.elapsedTurns.map(({ itemId, sequence, text, receivedAt }) => ({
      itemId,
      sequence,
      text,
      receivedAt,
    })),
    currentNoteSnapshot: context.currentNote,
    generatedAt: new Date().toISOString(),
    fallback,
  });
}

function fallbackRejoinPacket(context: UnderstandingRejoinContext) {
  const assistantPoints = context.branchMessages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.answer?.keyPoints ?? [])
    .slice(0, 6);
  return publishRejoinPacket(context, {
    understoodContent: assistantPoints.length > 0
      ? assistantPoints
      : ["개인 보충 설명의 대화 기록을 다시 확인해 주세요."],
    lectureProgress: context.elapsedTurns.length > 0
      ? context.elapsedTurns.slice(-8).map((turn) => turn.text)
      : ["분기 중 새로 기록된 발화가 없습니다."],
    currentLecturePosition: context.knownCurrentLecturePosition,
    connection: context.elapsedTurns.length > 0
      ? `보충 설명의 중심인 “${context.focusText.slice(0, 120)}”에서 이어진 실제 발화를 원문 순서로 확인하세요.`
      : "같은 수업 위치에서 다시 들으면 됩니다.",
    listenFor: context.currentNote
      ? [context.currentNote.sections.at(-1)?.heading ?? context.currentNote.title]
      : ["가장 최근 대본의 핵심 용어와 다음 전환을 확인하세요."],
    sourceItemIds: context.elapsedTurns.map((turn) => turn.itemId),
  }, true);
}

function requireCurrentBranch(
  session: LectureSession,
  branchId: string,
  epoch: number,
): UnderstandingBranch {
  if (session.understandingBranchEpoch !== epoch) {
    throw new Error("UNDERSTANDING_BRANCH_JOB_STALE");
  }
  const branch = findBranch(session, branchId);
  if (!branch) throw new Error("UNDERSTANDING_BRANCH_JOB_STALE");
  return branch;
}

function activeBranch(session: LectureSession): UnderstandingBranch | undefined {
  return session.understandingBranches.find(
    (branch) => branch.status === "active" || branch.status === "rejoining",
  );
}

function findBranch(
  session: LectureSession,
  branchId: string,
): UnderstandingBranch | undefined {
  return session.understandingBranches.find((branch) => branch.id === branchId);
}

function hasMaterial(session: LectureSession): boolean {
  return Boolean(
    session.materialKnowledge.title ||
    session.materialKnowledge.summary ||
    session.materialKnowledge.outline.length,
  );
}

function branchLog(
  session: LectureSession,
  branch: UnderstandingBranch,
  durationMs: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    branchId: branch.id,
    status: branch.status,
    startSequence: branch.startedAtSequence,
    endSequence: branch.endedAtSequence,
    messageCount: branch.messages.length,
    durationMs,
    reason,
  };
}
