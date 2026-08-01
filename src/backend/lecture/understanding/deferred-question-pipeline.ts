import { randomUUID } from "node:crypto";
import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../../env";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import { getOpenAIClient } from "../../openai-client";
import {
  DeferredQuestionDecisionSchema,
  DeferredQuestionInputSchema,
  DeferredQuestionSchema,
  type DeferredQuestion,
  type DeferredQuestionDecision,
  type LectureSession,
  type Transcript,
} from "../../schemas";
import { touchSession } from "../../session-store";
import { validateQuestionTranscriptSelection } from "../questions/validate-transcript-selection";

const AUTO_CHECK_TRANSCRIPT_COUNT = 5;

export interface DeferredQuestionCheckContext {
  deferredQuestionId: string;
  focusText: string;
  question: string;
  startedAtSequence: number;
  checkedThroughSequence: number;
  subsequentTranscript: Transcript[];
}

export type DeferredQuestionJudge = (
  context: DeferredQuestionCheckContext,
) => Promise<DeferredQuestionDecision>;

export interface DeferredQuestionResult {
  accepted: boolean;
  question: DeferredQuestion;
  message: string;
}

export function createDeferredQuestion(
  session: LectureSession,
  untrustedInput: unknown,
): DeferredQuestionResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_DEFERRED_QUESTION");
  }
  const input = DeferredQuestionInputSchema.parse(untrustedInput);
  const latest = session.transcripts.at(-1);
  if (!latest) throw new Error("DEFERRED_QUESTION_NEEDS_TRANSCRIPT");
  const snapshotSequence = latest.sequence;
  const selection = input.selection
    ? validateQuestionTranscriptSelection(session, input.selection, snapshotSequence)
    : null;
  const focusText = selection?.selectedText ?? latest.text;
  const questionText = input.question ??
    "이 부분이 왜 성립하는지, 어떤 의미인지, 앞뒤 설명과 어떻게 연결되는지 확인해 주세요.";
  const duplicate = session.deferredQuestions.find((candidate) =>
    candidate.status !== "resolved" &&
    candidate.focusText === focusText &&
    candidate.question === questionText
  );
  if (duplicate) {
    return { accepted: false, question: duplicate, message: "이미 맡겨둔 같은 질문이 있습니다." };
  }
  const question = DeferredQuestionSchema.parse({
    id: randomUUID(),
    sessionId: session.id,
    focusText,
    question: questionText,
    selection,
    createdAt: new Date().toISOString(),
    startedAtSequence: snapshotSequence,
    startedAtRevision: session.lectureRevision,
    status: "pending",
    checkStatus: "idle",
    lastCheckedThroughSequence: snapshotSequence,
    checkedAt: null,
    checkCount: 0,
    lectureExplanation: null,
    relatedItemIds: [],
    relatedSequences: [],
    resolvedAt: null,
    errorMessage: null,
  });
  session.deferredQuestions.push(question);
  touchSession(session);
  appendRawLog(session, "system", "deferred_question_created", deferredLog(
    session,
    question,
    0,
    "question_saved_without_immediate_explanation",
  ));
  return {
    accepted: true,
    question,
    message: "질문을 맡아두었습니다. 교수자가 뒤에서 설명하는지 확인할게요.",
  };
}

export function scheduleDeferredQuestionChecks(
  session: LectureSession,
  judge: DeferredQuestionJudge = judgeDeferredQuestionWithModel,
): void {
  const latestSequence = session.transcripts.at(-1)?.sequence ?? 0;
  for (const question of session.deferredQuestions) {
    if (
      question.status === "pending" &&
      question.checkStatus === "idle" &&
      countNewTurns(session, question, latestSequence) >= AUTO_CHECK_TRANSCRIPT_COUNT
    ) {
      enqueueDeferredQuestionCheck(session, question.id, judge, false);
    }
  }
}

export function requestDeferredQuestionCheck(
  session: LectureSession,
  questionId: string,
  judge: DeferredQuestionJudge = judgeDeferredQuestionWithModel,
): DeferredQuestionResult {
  const question = findQuestion(session, questionId);
  if (!question) throw new Error("DEFERRED_QUESTION_NOT_FOUND");
  if (question.status === "resolved") {
    return { accepted: false, question, message: "이미 해결된 질문입니다." };
  }
  if (question.checkStatus === "checking") {
    return { accepted: false, question, message: "교수자의 이후 설명을 확인하고 있습니다." };
  }
  enqueueDeferredQuestionCheck(session, question.id, judge, true);
  return { accepted: true, question, message: "이후 수업 대본에서 설명 여부를 확인합니다." };
}

export function updateDeferredQuestion(
  session: LectureSession,
  questionId: string,
  action: "resolve" | "keep_waiting" | "still_confused",
): DeferredQuestionResult {
  const question = findQuestion(session, questionId);
  if (!question) throw new Error("DEFERRED_QUESTION_NOT_FOUND");
  if (action === "resolve") {
    question.status = "resolved";
    question.resolvedAt = new Date().toISOString();
    question.checkStatus = "idle";
  } else if (action === "keep_waiting") {
    question.status = "pending";
    question.resolvedAt = null;
    question.errorMessage = null;
  } else {
    question.status = "ai_explanation_available";
    question.resolvedAt = null;
    question.errorMessage = null;
  }
  touchSession(session);
  if (action === "resolve") {
    appendRawLog(session, "system", "deferred_question_resolved", deferredLog(
      session,
      question,
      0,
      "resolved_by_student",
    ));
  }
  return {
    accepted: true,
    question,
    message: action === "resolve"
      ? "해결된 질문으로 표시했습니다."
      : action === "keep_waiting"
        ? "교수자의 다음 설명을 계속 확인합니다."
        : "AI 보충 설명을 열 수 있습니다.",
  };
}

function enqueueDeferredQuestionCheck(
  session: LectureSession,
  questionId: string,
  judge: DeferredQuestionJudge,
  force: boolean,
): void {
  const question = findQuestion(session, questionId);
  if (!question || question.checkStatus === "checking") return;
  const latestSequence = session.transcripts.at(-1)?.sequence ?? question.startedAtSequence;
  if (!force && countNewTurns(session, question, latestSequence) < AUTO_CHECK_TRANSCRIPT_COUNT) {
    return;
  }
  const context = buildCheckContext(session, question, latestSequence);
  question.checkStatus = "checking";
  question.errorMessage = null;
  const epoch = session.deferredQuestionEpoch;
  touchSession(session);
  session.deferredQuestionChain = session.deferredQuestionChain
    .catch(() => undefined)
    .then(() => runDeferredQuestionCheck(session, questionId, context, epoch, judge))
    .catch((error) => {
      recordSessionError(session, "deferred_question_chain", error, { questionId });
    });
}

async function runDeferredQuestionCheck(
  session: LectureSession,
  questionId: string,
  context: DeferredQuestionCheckContext,
  epoch: number,
  judge: DeferredQuestionJudge,
): Promise<void> {
  if (session.deferredQuestionEpoch !== epoch) return;
  const startedAt = Date.now();
  try {
    const decision = DeferredQuestionDecisionSchema.parse(await judge(context));
    const question = requireCurrentQuestion(session, questionId, epoch);
    const availableById = new Map(
      context.subsequentTranscript.map((turn) => [turn.itemId, turn]),
    );
    const relatedTurns = Array.from(new Set(decision.relatedItemIds))
      .flatMap((itemId) => {
        const turn = availableById.get(itemId);
        return turn ? [turn] : [];
      });
    const explained = decision.explained && relatedTurns.length > 0;
    question.status = explained ? "explained_by_lecture" : "ai_explanation_available";
    question.checkStatus = "idle";
    question.lastCheckedThroughSequence = context.checkedThroughSequence;
    question.checkedAt = new Date().toISOString();
    question.checkCount += 1;
    question.lectureExplanation = explained
      ? decision.explanation || "교수자의 이후 발화에서 관련 설명을 확인했습니다."
      : null;
    question.relatedItemIds = relatedTurns.map((turn) => turn.itemId);
    question.relatedSequences = relatedTurns.map((turn) => turn.sequence);
    question.errorMessage = null;
    touchSession(session);
    appendRawLog(session, "system", "deferred_question_checked", deferredLog(
      session,
      question,
      Date.now() - startedAt,
      explained ? "lecture_explanation_found" : "lecture_explanation_not_found",
    ));
    appendRawLog(
      session,
      "system",
      explained
        ? "deferred_question_explained_by_lecture"
        : "deferred_question_unresolved",
      deferredLog(
        session,
        question,
        Date.now() - startedAt,
        explained ? "student_confirmation_required" : "ai_explanation_available",
      ),
    );
  } catch (error) {
    if (session.deferredQuestionEpoch !== epoch) return;
    const question = findQuestion(session, questionId);
    if (!question) return;
    question.status = "failed";
    question.checkStatus = "idle";
    question.lastCheckedThroughSequence = context.checkedThroughSequence;
    question.checkedAt = new Date().toISOString();
    question.checkCount += 1;
    question.errorMessage = "설명 여부를 판단하지 못했습니다. 다시 확인할 수 있습니다.";
    touchSession(session);
    appendRawLog(session, "error", "deferred_question_checked", deferredLog(
      session,
      question,
      Date.now() - startedAt,
      error instanceof Error ? error.message : "unknown_deferred_question_error",
    ));
    recordSessionError(session, "deferred_question_check", error, { questionId });
  }
}

export async function judgeDeferredQuestionWithModel(
  context: DeferredQuestionCheckContext,
): Promise<DeferredQuestionDecision> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
    input: [
      {
        role: "system",
        content: `학생이 맡겨둔 질문을 교수자의 이후 실제 발화가 충분히 설명했는지 보수적으로 판단한다. 단순히 같은 단어가 등장한 것은 설명이 아니다. 이유, 의미, 원리 또는 앞뒤 연결 중 질문의 핵심을 실제로 풀어 준 경우에만 explained=true로 한다.

외부 지식이나 웹 검색을 사용하지 않는다. explanation에는 교수 발화에서 확인된 핵심만 간결하게 요약한다. relatedItemIds에는 제공된 subsequentTranscript의 itemId만 넣는다. 충분하지 않으면 explained=false, explanation은 빈 문자열, relatedItemIds는 빈 배열로 반환한다.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          selectedFocus: context.focusText,
          studentQuestion: context.question,
          subsequentTranscript: context.subsequentTranscript,
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        DeferredQuestionDecisionSchema,
        "deferred_question_decision",
      ),
    },
  });
  if (!response.output_parsed) throw new Error("DEFERRED_QUESTION_EMPTY_OUTPUT");
  return DeferredQuestionDecisionSchema.parse(response.output_parsed);
}

function buildCheckContext(
  session: LectureSession,
  question: DeferredQuestion,
  throughSequence: number,
): DeferredQuestionCheckContext {
  return {
    deferredQuestionId: question.id,
    focusText: question.focusText,
    question: question.question,
    startedAtSequence: question.startedAtSequence,
    checkedThroughSequence: throughSequence,
    subsequentTranscript: session.transcripts
      .filter((turn) =>
        turn.sequence > question.startedAtSequence &&
        turn.sequence <= throughSequence
      )
      .map((turn) => structuredClone(turn)),
  };
}

function countNewTurns(
  session: LectureSession,
  question: DeferredQuestion,
  throughSequence: number,
): number {
  return session.transcripts.filter((turn) =>
    turn.sequence > question.lastCheckedThroughSequence &&
    turn.sequence <= throughSequence
  ).length;
}

function requireCurrentQuestion(
  session: LectureSession,
  questionId: string,
  epoch: number,
): DeferredQuestion {
  if (session.deferredQuestionEpoch !== epoch) {
    throw new Error("DEFERRED_QUESTION_JOB_STALE");
  }
  const question = findQuestion(session, questionId);
  if (!question) throw new Error("DEFERRED_QUESTION_JOB_STALE");
  return question;
}

function findQuestion(
  session: LectureSession,
  questionId: string,
): DeferredQuestion | undefined {
  return session.deferredQuestions.find((question) => question.id === questionId);
}

function deferredLog(
  session: LectureSession,
  question: DeferredQuestion,
  durationMs: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    deferredQuestionId: question.id,
    status: question.status,
    startSequence: question.startedAtSequence,
    checkedThroughSequence: question.lastCheckedThroughSequence,
    relatedSequences: question.relatedSequences,
    checkCount: question.checkCount,
    durationMs,
    reason,
  };
}
