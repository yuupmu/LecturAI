import { randomUUID } from "node:crypto";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import {
  LectureAnswerDraftSchema,
  LectureAnswerReviewSchema,
  LectureQuestionInputSchema,
  LectureQuestionSchema,
  type LectureAnswerDraft,
  type LectureAnswerReview,
  type LectureQuestion,
  type LectureQuestionInput,
  type LectureSession,
  type TranscriptSelectionContext,
} from "../../schemas";
import { touchSession } from "../../session-store";
import {
  answerLectureQuestion,
  type LectureQuestionComposer,
} from "./answer-lecture-question";
import { publishGroundedAnswer } from "./build-answer-evidence";
import {
  buildQuestionContext,
  type LectureQuestionContext,
} from "./build-question-context";
import {
  reviewLectureAnswer,
  type LectureQuestionReviewer,
} from "./review-lecture-answer";
import {
  validateQuestionTranscriptSelection,
} from "./validate-transcript-selection";
import {
  resolveTranscriptSelectionIntent,
  TRANSCRIPT_SELECTION_QUESTION_TEXT,
} from "./transcript-selection-prompts";

export interface QuestionDependencies {
  compose: LectureQuestionComposer;
  review: LectureQuestionReviewer;
}

const defaultDependencies: QuestionDependencies = {
  compose: answerLectureQuestion,
  review: reviewLectureAnswer,
};

export interface CreateQuestionResult {
  question: LectureQuestion;
  accepted: boolean;
}

export function createLectureQuestion(
  session: LectureSession,
  untrustedInput: string | LectureQuestionInput,
  dependencies: QuestionDependencies = defaultDependencies,
): CreateQuestionResult {
  if (session.status === "finalizing" || session.status === "ended") {
    throw new Error("SESSION_NOT_ACCEPTING_QUESTIONS");
  }
  const input = LectureQuestionInputSchema.parse(
    typeof untrustedInput === "string"
      ? { question: untrustedInput }
      : untrustedInput,
  );
  const snapshotSequence = session.transcripts.at(-1)?.sequence ?? 0;
  const lectureRevision = session.lectureRevision;
  const selection = input.selection
    ? validateQuestionTranscriptSelection(session, input.selection, snapshotSequence)
    : null;
  const questionText = input.question ?? selectionQuestionText(selection);
  const answerLanguage = resolveAnswerLanguage(session, selection);
  const question = LectureQuestionSchema.parse({
    id: randomUUID(),
    sessionId: session.id,
    question: questionText,
    selection,
    answerLanguage,
    askedAt: new Date().toISOString(),
    askedAtSequence: snapshotSequence || null,
    lectureRevision,
    status: "queued",
    answer: null,
    errorMessage: null,
  });
  const context = buildQuestionContext(
    session,
    question.question,
    snapshotSequence,
    lectureRevision,
    selection,
    answerLanguage,
  );
  const epoch = session.questionEpoch;
  session.questions.push(question);
  touchSession(session);
  appendRawLog(session, "system", "question_created", questionLog(
    session,
    question,
    context,
    0,
    "snapshot_captured",
  ));
  appendRawLog(session, "system", "question_context_built", {
    ...questionLog(session, question, context, 0, "hybrid_local_relevance"),
    materialExcerptCount: context.materialContext.length,
    noteExcerptCount: context.noteContext.length,
    transcriptExcerptCount: context.transcriptContext.length,
    hasOpenUnit: context.openUnitContext !== null,
  });

  const run = async () => runQuestionJob(
    session,
    question.id,
    context,
    epoch,
    dependencies,
  );
  session.questionChain = session.questionChain
    .catch(() => undefined)
    .then(run)
    .catch((error) => {
      recordSessionError(session, "question_chain", error, {
        questionId: question.id,
      });
    });
  return { question, accepted: true };
}

function selectionQuestionText(
  selection: TranscriptSelectionContext | null,
): string {
  const intent = resolveTranscriptSelectionIntent(selection?.intent);
  return TRANSCRIPT_SELECTION_QUESTION_TEXT[intent][
    selection?.targetLanguage === "en" ? "en" : "ko"
  ];
}

function resolveAnswerLanguage(
  session: LectureSession,
  selection: TranscriptSelectionContext | null,
) {
  if (selection?.kind === "translation" && selection.targetLanguage) {
    return selection.targetLanguage;
  }
  return session.translationSettings.enabled
    ? session.translationSettings.targetLanguage
    : null;
}

async function runQuestionJob(
  session: LectureSession,
  questionId: string,
  context: LectureQuestionContext,
  epoch: number,
  dependencies: QuestionDependencies,
): Promise<void> {
  if (session.questionEpoch !== epoch) return;
  const question = findQuestion(session, questionId);
  if (!question) return;
  const startedAt = Date.now();
  question.status = "answering";
  question.errorMessage = null;
  touchSession(session);

  try {
    let draft = LectureAnswerDraftSchema.parse(await dependencies.compose(context));
    assertQuestionCurrent(session, epoch, questionId);
    appendRawLog(session, "system", "question_answer_drafted", questionLog(
      session,
      question,
      context,
      Date.now() - startedAt,
      draft.answerable ? "answerable_draft" : "composer_insufficient_context",
    ));

    if (!draft.answerable) {
      publishInsufficient(session, question, context, startedAt, "composer_insufficient_context");
      return;
    }

    const review = LectureAnswerReviewSchema.parse(
      await dependencies.review(context, draft),
    );
    assertQuestionCurrent(session, epoch, questionId);
    appendRawLog(session, "system", "question_answer_reviewed", {
      ...questionLog(
        session,
        question,
        context,
        Date.now() - startedAt,
        review.publishable ? "publishable" : "single_revision_required",
      ),
      unsupportedEvidenceCount: review.unsupportedEvidenceIndexes.length,
    });
    if (!review.publishable) {
      draft = LectureAnswerDraftSchema.parse(await dependencies.compose(
        context,
        review.revisionInstructions,
      ));
      assertQuestionCurrent(session, epoch, questionId);
    }
    const sanitizedDraft = removeUnsupportedEvidence(draft, review);
    const answer = publishGroundedAnswer(context, sanitizedDraft);
    if (!answer) {
      publishInsufficient(session, question, context, startedAt, "server_grounding_rejected");
      return;
    }
    question.answer = answer;
    question.status = "answered";
    question.errorMessage = null;
    touchSession(session);
    appendRawLog(session, "system", "question_answer_published", {
      ...questionLog(
        session,
        question,
        context,
        Date.now() - startedAt,
        "grounded_answer_published",
      ),
      evidenceCount: answer.evidence.length,
      basedOn: answer.basedOn,
    });
  } catch (error) {
    if (session.questionEpoch !== epoch) return;
    const current = findQuestion(session, questionId);
    if (!current) return;
    current.status = "failed";
    current.answer = null;
    current.errorMessage = "답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    touchSession(session);
    appendRawLog(session, "error", "question_failed", questionLog(
      session,
      current,
      context,
      Date.now() - startedAt,
      error instanceof Error ? error.message : "unknown_question_error",
    ));
    recordSessionError(session, "question_generation", error, {
      questionId,
      lectureRevision: context.lectureRevision,
      snapshotSequence: context.snapshotSequence,
    });
  }
}

function removeUnsupportedEvidence(
  draft: LectureAnswerDraft,
  review: LectureAnswerReview,
): LectureAnswerDraft {
  if (!review.publishable) return draft;
  const rejected = new Set(review.unsupportedEvidenceIndexes);
  return {
    ...draft,
    evidenceRefs: draft.evidenceRefs.filter((_entry, index) => !rejected.has(index)),
  };
}

function publishInsufficient(
  session: LectureSession,
  question: LectureQuestion,
  context: LectureQuestionContext,
  startedAt: number,
  reason: string,
): void {
  question.status = "insufficient_context";
  question.answer = null;
  question.errorMessage = "현재 PPT와 지금까지의 수업 대본만으로는 이 질문에 답할 충분한 내용이 없습니다.";
  touchSession(session);
  appendRawLog(session, "system", "question_insufficient_context", questionLog(
    session,
    question,
    context,
    Date.now() - startedAt,
    reason,
  ));
}

function assertQuestionCurrent(
  session: LectureSession,
  epoch: number,
  questionId: string,
): void {
  if (session.questionEpoch !== epoch || !findQuestion(session, questionId)) {
    throw new Error("QUESTION_JOB_STALE");
  }
}

function findQuestion(session: LectureSession, questionId: string): LectureQuestion | undefined {
  return session.questions.find((candidate) => candidate.id === questionId);
}

function questionLog(
  session: LectureSession,
  question: LectureQuestion,
  context: LectureQuestionContext,
  durationMs: number,
  reason: string,
) {
  return {
    sessionId: session.id,
    lectureRevision: question.lectureRevision,
    questionId: question.id,
    absenceSpanId: null,
    sourceItemIds: context.transcriptContext.map((turn) => turn.itemId),
    selectionKind: question.selection?.kind ?? null,
    selectionIntent: question.selection
      ? resolveTranscriptSelectionIntent(question.selection.intent)
      : null,
    selectionLanguage: question.selection?.targetLanguage ?? null,
    answerLanguage: question.answerLanguage,
    snapshotSequence: context.snapshotSequence,
    durationMs,
    reason,
  };
}
