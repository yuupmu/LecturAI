"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  DeferredQuestionDto,
  TranscriptDto,
  UnderstandingBranchDto,
} from "@/frontend/types";
import styles from "./ParallelLecturePanel.module.css";

export function ParallelLecturePanel({
  branches,
  deferredQuestions,
  transcripts,
  disabled,
  sessionEnded,
  feedback,
  openingInteraction,
  onMessage,
  onRejoin,
  onResumeLecture,
  onCheckDeferred,
  onUpdateDeferred,
  onExplainDeferred,
}: {
  branches: UnderstandingBranchDto[];
  deferredQuestions: DeferredQuestionDto[];
  transcripts: TranscriptDto[];
  disabled: boolean;
  sessionEnded: boolean;
  feedback: string | null;
  openingInteraction?: {
    selectedText: string | null;
    requestedAt: number;
    previousBranchCount: number;
  } | null;
  onMessage: (branchId: string, message: string) => Promise<void>;
  onRejoin: (branchId: string) => Promise<void>;
  onResumeLecture: (branch: UnderstandingBranchDto) => void;
  onCheckDeferred: (questionId: string) => Promise<void>;
  onUpdateDeferred: (
    questionId: string,
    action: "resolve" | "keep_waiting" | "still_confused",
  ) => Promise<void>;
  onExplainDeferred: (questionId: string) => Promise<void>;
}) {
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dismissedRejoins, setDismissedRejoins] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeBranch = branches.find(
    (branch) => branch.status === "active" || branch.status === "rejoining",
  ) ?? null;
  const completedBranches = useMemo(
    () => branches.filter((branch) => branch.status === "completed").slice().reverse(),
    [branches],
  );
  const newestCompleted = completedBranches[0] ?? null;
  const latestCompleted = newestCompleted && !dismissedRejoins.has(newestCompleted.id)
    ? newestCompleted
    : null;
  const olderCompleted = activeBranch
    ? completedBranches
    : latestCompleted
      ? completedBranches.slice(1)
      : completedBranches;

  const archiveRejoin = (branchId: string) => {
    setDismissedRejoins((current) => new Set(current).add(branchId));
  };

  useEffect(() => {
    if (!activeBranch) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeBranch]);

  const questionsVisible = questionsOpen || (
    sessionEnded && deferredQuestions.some((question) => question.status !== "resolved")
  );

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeBranch || !message.trim() || actionBusy) return;
    const next = message.trim();
    setActionBusy(`message:${activeBranch.id}`);
    try {
      await onMessage(activeBranch.id, next);
      setMessage("");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <section className={styles.parallelPanel} aria-label="이해 분기와 맡겨둔 질문">
      <header className={styles.panelHeader}>
        <div>
          <strong>PARALLEL LECTURE</strong>
          <span>이해 분기 · 수업 기록은 계속</span>
        </div>
        <button type="button" onClick={() => setQuestionsOpen((value) => !value)}>
          맡겨둔 질문 {deferredQuestions.filter((question) => question.status !== "resolved").length}
        </button>
      </header>

      {feedback && <p className={styles.feedback} role="status">{feedback}</p>}

      {actionBusy && (
        <div className={styles.actionPending} role="status" aria-live="assertive">
          <i aria-hidden="true" />
          <span>{interactionActionLabel(actionBusy)}</span>
        </div>
      )}

      {openingInteraction && !activeBranch && (
        <div className={styles.interactionPending} role="status" aria-live="assertive">
          <div className={styles.analysisSignal} aria-hidden="true"><i /><i /><i /></div>
          <div>
            <span>INTERACTION STARTED</span>
            <strong>AI가 분석하고 있어요</strong>
            <p>상호작용 화면을 먼저 열었습니다. 수업 자료와 방금 대본을 연결한 설명이 이곳에 이어서 표시됩니다.</p>
          </div>
          {openingInteraction.selectedText && (
            <blockquote>“{openingInteraction.selectedText}”</blockquote>
          )}
        </div>
      )}

      {activeBranch ? (
        <ActiveBranch
          branch={activeBranch}
          now={now}
          newTranscriptCount={transcripts.filter(
            (turn) => turn.sequence > activeBranch.startedAtSequence,
          ).length}
          message={message}
          busy={actionBusy !== null}
          disabled={disabled}
          onMessage={setMessage}
          onSubmit={submitMessage}
          onRejoin={async () => {
            if (actionBusy) return;
            setActionBusy(`rejoin:${activeBranch.id}`);
            try {
              await onRejoin(activeBranch.id);
            } finally {
              setActionBusy(null);
            }
          }}
        />
      ) : openingInteraction ? null : latestCompleted ? (
        <RejoinCard
          branch={latestCompleted}
          primary
          onResume={() => {
            archiveRejoin(latestCompleted.id);
            onResumeLecture(latestCompleted);
          }}
          onSaveForLater={() => archiveRejoin(latestCompleted.id)}
        />
      ) : (
        <p className={styles.idleCopy}>
          대본을 선택하거나 “방금 내용이 이해되지 않아요”를 눌러 개인 보충 설명을 열 수 있습니다.
        </p>
      )}

      {questionsVisible && (
        <DeferredQuestionList
          questions={deferredQuestions}
          busy={actionBusy}
          onAction={async (key, action) => {
            if (actionBusy) return;
            setActionBusy(key);
            try {
              await action();
            } finally {
              setActionBusy(null);
            }
          }}
          onCheckDeferred={onCheckDeferred}
          onUpdateDeferred={onUpdateDeferred}
          onExplainDeferred={onExplainDeferred}
        />
      )}

      {olderCompleted.length > 0 && (
        <div className={styles.history}>
          <button type="button" onClick={() => setHistoryOpen((value) => !value)}>
            지난 합류 기록 {olderCompleted.length} {historyOpen ? "접기" : "보기"}
          </button>
          {historyOpen && olderCompleted.map((branch) => (
            <RejoinCard key={branch.id} branch={branch} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveBranch({
  branch,
  now,
  newTranscriptCount,
  message,
  busy,
  disabled,
  onMessage,
  onSubmit,
  onRejoin,
}: {
  branch: UnderstandingBranchDto;
  now: number;
  newTranscriptCount: number;
  message: string;
  busy: boolean;
  disabled: boolean;
  onMessage: (message: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRejoin: () => Promise<void>;
}) {
  const elapsed = Math.max(0, Math.floor((now - new Date(branch.startedAt).getTime()) / 1_000));
  return (
    <div className={styles.activeBranch}>
      <div className={styles.liveNotice} role="status">
        <i aria-hidden="true" />
        <div>
          <strong>개인 보충 설명을 보고 있습니다.</strong>
          <span>실제 수업은 계속 기록 중입니다. 합류할 때 그동안의 내용을 연결해 드립니다.</span>
        </div>
        <small>{formatDuration(elapsed)} · 새 발화 {newTranscriptCount}개</small>
      </div>

      <blockquote>{branch.focusText}</blockquote>
      <div className={styles.messages} aria-live="polite">
        {branch.messages.map((entry) => (
          <article key={entry.id} data-role={entry.role}>
            <span>{entry.role === "assistant" ? "AI 보충 설명" : "나"}</span>
            {entry.answer ? (
              <div>
                <strong>{entry.answer.title}</strong>
                <p>{entry.answer.directAnswer}</p>
                <p>{entry.answer.explanation}</p>
                {entry.answer.keyPoints.length > 0 && (
                  <ul>{entry.answer.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                )}
                {entry.answer.example && <p className={styles.example}>예시 · {entry.answer.example}</p>}
              </div>
            ) : <p>{entry.content}</p>}
          </article>
        ))}
        {(branch.explanationStatus === "answering" || branch.messageStatus === "answering") && (
          <div className={styles.inlineAnalysis} role="status">
            <i aria-hidden="true" />
            <p>AI가 수업 전체 맥락을 분석하고 있어요. 설명이 준비되는 대로 이 화면에 표시됩니다.</p>
          </div>
        )}
        {branch.errorMessage && <p className={styles.error} role="alert">{branch.errorMessage}</p>}
      </div>

      {branch.status === "active" && (
        <>
          <form className={styles.followUp} onSubmit={onSubmit}>
            <input
              value={message}
              onChange={(event) => onMessage(event.target.value)}
              placeholder="이 설명에서 더 궁금한 점을 물어보세요"
              maxLength={4_000}
              disabled={busy || branch.messageStatus === "answering"}
            />
            <button type="submit" disabled={busy || !message.trim() || branch.messageStatus === "answering"}>
              질문
            </button>
          </form>
          <button
            className={styles.rejoinButton}
            type="button"
            disabled={busy}
            onClick={() => void onRejoin()}
          >
            이제 이해했어요 · 현재 수업으로 합류
          </button>
        </>
      )}
      {branch.status === "rejoining" && (
        <p className={styles.thinking}>분기 중 지나간 수업과 현재 위치를 연결하고 있습니다…</p>
      )}
      {disabled && branch.status === "active" && (
        <small className={styles.endedHint}>수업은 종료되었지만 마지막 위치로 합류할 수 있습니다.</small>
      )}
    </div>
  );
}

function DeferredQuestionList({
  questions,
  busy,
  onAction,
  onCheckDeferred,
  onUpdateDeferred,
  onExplainDeferred,
}: {
  questions: DeferredQuestionDto[];
  busy: string | null;
  onAction: (key: string, action: () => Promise<void>) => Promise<void>;
  onCheckDeferred: (questionId: string) => Promise<void>;
  onUpdateDeferred: (
    questionId: string,
    action: "resolve" | "keep_waiting" | "still_confused",
  ) => Promise<void>;
  onExplainDeferred: (questionId: string) => Promise<void>;
}) {
  if (questions.length === 0) {
    return <p className={styles.emptyQuestions}>맡겨둔 질문이 없습니다.</p>;
  }
  return (
    <div className={styles.deferredList}>
      {questions.slice().reverse().map((question) => (
        <article key={question.id}>
          <span className={styles.statusBadge} data-status={question.status}>
            {deferredStatusLabel(question)}
          </span>
          <strong>{question.question}</strong>
          <blockquote>{question.focusText}</blockquote>
          {question.lectureExplanation && <p>{question.lectureExplanation}</p>}
          {question.errorMessage && <p className={styles.error}>{question.errorMessage}</p>}
          <div className={styles.questionActions}>
            {question.relatedItemIds[0] && (
              <button type="button" onClick={() => scrollToTranscript(question.relatedItemIds[0])}>
                해당 대본 보기
              </button>
            )}
            {question.status !== "resolved" && (
              <button
                type="button"
                disabled={busy !== null || question.checkStatus === "checking"}
                onClick={() => void onAction(`check:${question.id}`, () => onCheckDeferred(question.id))}
              >
                {question.checkStatus === "checking" ? "확인 중…" : "지금 확인"}
              </button>
            )}
            {(question.status === "ai_explanation_available" ||
              question.status === "failed" ||
              question.status === "explained_by_lecture") && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onAction(`explain:${question.id}`, () => onExplainDeferred(question.id))}
              >
                더 자세히 설명
              </button>
            )}
            {question.status !== "resolved" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onAction(
                  `resolve:${question.id}`,
                  () => onUpdateDeferred(question.id, "resolve"),
                )}
              >
                해결됨
              </button>
            )}
            {question.status === "explained_by_lecture" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onAction(
                  `confused:${question.id}`,
                  () => onUpdateDeferred(question.id, "still_confused"),
                )}
              >
                아직 모르겠어요
              </button>
            )}
            {question.status === "ai_explanation_available" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onAction(
                  `wait:${question.id}`,
                  () => onUpdateDeferred(question.id, "keep_waiting"),
                )}
              >
                계속 기다리기
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function RejoinCard({
  branch,
  primary = false,
  onResume,
  onSaveForLater,
}: {
  branch: UnderstandingBranchDto;
  primary?: boolean;
  onResume?: () => void;
  onSaveForLater?: () => void;
}) {
  const packet = branch.rejoinPacket;
  if (!packet) return null;
  return (
    <article className={styles.rejoinCard}>
      <div>
        <strong>{primary ? "현재 수업으로 합류하기" : "지난 합류 기록"}</strong>
        {packet.fallback && <span>원본 기록 기반 fallback</span>}
      </div>
      <small>
        {formatClock(branch.startedAt)} → {branch.endedAt ? formatClock(branch.endedAt) : "--:--:--"}
        {` · #${branch.startedAtSequence}–#${branch.endedAtSequence ?? branch.startedAtSequence}`}
      </small>
      <div className={styles.quickRejoin}>
        <span>QUICK REJOIN · 10초</span>
        <h4>지금 반드시 알아야 할 내용</h4>
        <ul>{packet.quickRejoin.mustKnowNow.map((item) => <li key={item}>{item}</li>)}</ul>
        <h4>현재 수업</h4>
        <p>{packet.quickRejoin.currentTopic}</p>
        <h4>연결해서 이해하기</h4>
        <p>{packet.quickRejoin.bridgeSentence}</p>
        <h4>지금부터 들어야 할 내용</h4>
        <p>{packet.quickRejoin.listenForNext}</p>
      </div>
      {primary && onResume && (
        <button className={styles.resumeButton} type="button" onClick={onResume}>
          현재 수업으로 합류
        </button>
      )}
      <details className={styles.detailedCatchUp}>
        <summary>놓친 내용 자세히 보기</summary>
        <h4>개인 보충 설명에서 확인한 내용</h4>
        <p>{packet.detailedCatchUp.branchSummary}</p>
        <h4>분기 중 실제 수업에서 지나간 내용</h4>
        <p>{packet.detailedCatchUp.missedLectureSummary}</p>
        {packet.detailedCatchUp.keyPoints.length > 0 && (
          <ul>{packet.detailedCatchUp.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        {packet.rawTranscript.length > 0 && (
          <details>
            <summary>관련 대본 구간</summary>
            {packet.rawTranscript.map((turn) => (
              <p key={turn.itemId}>#{turn.sequence} {turn.text}</p>
            ))}
          </details>
        )}
        {packet.currentNoteSnapshot && <p>최신 필기 · {packet.currentNoteSnapshot.title}</p>}
      </details>
      {primary && onSaveForLater && (
        <button className={styles.saveForLater} type="button" onClick={onSaveForLater}>
          수업 후 확인하기
        </button>
      )}
    </article>
  );
}

function deferredStatusLabel(question: DeferredQuestionDto): string {
  if (question.checkStatus === "checking") return "설명 확인 중";
  return {
    pending: "아직 대기 중",
    explained_by_lecture: "수업에서 설명됨",
    ai_explanation_available: question.lectureExplanation ? "수업 종료 후 AI 설명" : "AI 설명 가능",
    resolved: "사용자가 해결함",
    failed: "확인 실패",
  }[question.status];
}

function scrollToTranscript(itemId: string): void {
  document.getElementById(`transcript-${itemId}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function interactionActionLabel(action: string): string {
  if (action.startsWith("message:")) return "AI가 추가 질문을 분석하고 있어요. 답변은 이 화면에 이어서 표시됩니다.";
  if (action.startsWith("rejoin:")) return "AI가 지나간 수업과 현재 위치를 연결하고 있어요.";
  if (action.startsWith("check:")) return "AI가 이후 대본에서 교수자의 설명을 확인하고 있어요.";
  if (action.startsWith("explain:")) return "AI가 보충 설명을 준비하고 있어요.";
  return "요청을 바로 반영하고 있어요.";
}
