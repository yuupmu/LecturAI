"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, createSession, postTranscript } from "./api";
import {
  captureClientError,
  type ClientErrorLog,
} from "./error-log";
import styles from "./LecturAIApp.module.css";
import type {
  CreateSessionResponse,
  EmphasisEventDto,
  LectureEventDto,
  ReviewDto,
  SessionStateDto,
  SlideDto,
  SlideMapDto,
  TranscriptAction,
  TranscriptInputDto,
  UiPhase,
  VerificationEventDto,
} from "./types";
import {
  useRealtimeTranscription,
  type RealtimeFinalTranscript,
} from "./useRealtimeTranscription";
import { useSessionPolling } from "./useSessionPolling";

const DEFAULT_INSTRUCTION = `이 자료를 기준으로 수업을 끝까지 모니터링해줘.
명시적 강조와 자료-발화 불일치를 자동으로 감지하고,
필요한 경우 외부 근거를 검색해 보강해.
수업 종료를 감지하면 강조 내용 중심의 복습 문제를 만들어줘.`;

const DEMO_PRESETS = [
  ["정상 문장", "이진 탐색은 정렬된 배열에서 사용합니다."],
  ["강조 문장", "정렬된 배열이라는 전제는 시험에 꼭 나옵니다."],
  ["불일치 문장", "이진 탐색의 최악 시간복잡도는 O(n)입니다."],
  ["종료 문장", "오늘 수업은 여기까지 하겠습니다."],
] as const;

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function isSupportedMaterial(file: File): boolean {
  const filename = file.name.toLocaleLowerCase();
  return (
    file.type === "application/pdf" ||
    file.type === PPTX_MIME_TYPE ||
    filename.endsWith(".pdf") ||
    filename.endsWith(".pptx")
  );
}

// LecturAIApp owns the intentionally local, single-session demo state.
export default function LecturAIApp() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<UiPhase>("setup");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [language, setLanguage] = useState("ko");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupErrorLog, setSetupErrorLog] = useState<ClientErrorLog | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSeed, setSessionSeed] =
    useState<CreateSessionResponse | null>(null);
  const [materialUrl, setMaterialUrl] = useState<string | null>(null);
  const [pendingTranscriptIds, setPendingTranscriptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [lastAction, setLastAction] = useState<TranscriptAction>("none");
  const [noActionVisible, setNoActionVisible] = useState(false);
  const [transcriptWarning, setTranscriptWarning] = useState<string | null>(null);
  const [runtimeErrorLog, setRuntimeErrorLog] =
    useState<ClientErrorLog | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const noActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materialUrlRef = useRef<string | null>(null);
  const debugSequenceRef = useRef(100_000);

  const {
    state: polledState,
    delayed: pollingDelayed,
    errorLog: pollingErrorLog,
  } =
    useSessionPolling(sessionId);

  const sendTranscript = useCallback(
    async (transcript: TranscriptInputDto) => {
      if (!sessionId) return false;
      setPendingTranscriptIds((current) => {
        const next = new Set(current);
        next.add(transcript.itemId);
        return next;
      });
      setTranscriptWarning(null);
      try {
        const result = await postTranscript(sessionId, transcript);
        setLastAction(result.action);
        if (result.action === "none") {
          setNoActionVisible(true);
          if (noActionTimerRef.current) clearTimeout(noActionTimerRef.current);
          noActionTimerRef.current = setTimeout(
            () => setNoActionVisible(false),
            2_000,
          );
        } else {
          setNoActionVisible(false);
        }
        return true;
      } catch (error) {
        setRuntimeErrorLog(captureClientError("transcript.submit", error));
        setTranscriptWarning(
          "완성된 자막을 문맥과 대조하지 못했습니다. 다음 발화는 계속 듣습니다.",
        );
        return false;
      } finally {
        setPendingTranscriptIds((current) => {
          const next = new Set(current);
          next.delete(transcript.itemId);
          return next;
        });
      }
    },
    [sessionId],
  );

  const handleFinalTranscript = useCallback(
    async (transcript: RealtimeFinalTranscript) => {
      await sendTranscript({ ...transcript, source: "realtime" });
    },
    [sendTranscript],
  );

  const realtime = useRealtimeTranscription({
    onFinalTranscript: handleFinalTranscript,
  });
  const disconnectRealtime = realtime.disconnect;

  const effectiveState = polledState;
  const slideMap = effectiveState?.slideMap ?? sessionSeed?.slideMap ?? null;
  const lessonEnded =
    effectiveState?.status === "ended" && effectiveState.review !== null;
  const effectivePhase: UiPhase = lessonEnded ? "ended" : phase;
  const demoEnabled =
    process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTROLS === "true" ||
    searchParams.get("debug") === "1";

  useEffect(() => {
    materialUrlRef.current = materialUrl;
  }, [materialUrl]);

  useEffect(
    () => () => {
      if (materialUrlRef.current) URL.revokeObjectURL(materialUrlRef.current);
      if (noActionTimerRef.current) clearTimeout(noActionTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!lessonEnded) return;
    disconnectRealtime();
  }, [disconnectRealtime, lessonEnded]);

  useEffect(() => {
    if (!startedAt || effectivePhase !== "live") return;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [effectivePhase, startedAt]);

  const handleStart = async () => {
    if (!instruction.trim()) {
      setSetupError("수업을 어떻게 모니터링할지 최초 지시문을 적어주세요.");
      return;
    }

    let stream: MediaStream | null = null;
    let created: CreateSessionResponse | null = null;
    let nextMaterialUrl: string | null = null;
    setSetupError(null);
    setSetupErrorLog(null);
    setTranscriptWarning(null);
    setRuntimeErrorLog(null);
    setPhase("requesting-permission");

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (materialUrlRef.current) {
        URL.revokeObjectURL(materialUrlRef.current);
      }
      if (materialFile) {
        nextMaterialUrl = URL.createObjectURL(materialFile);
        setMaterialUrl(nextMaterialUrl);
      } else {
        setMaterialUrl(null);
      }

      setPhase("creating-session");
      created = await createSession({
        material: materialFile,
        instruction: instruction.trim(),
        language,
      });
      setSessionSeed(created);
      setSessionId(created.sessionId);
      setStartedAt(Date.now());
      setElapsedSeconds(0);

      setPhase("connecting-realtime");
      await realtime.connect(created.sessionId, stream);
      setPhase("live");
    } catch (startError) {
      const errorLog = captureClientError("lecture.start", startError);
      if (!created) {
        stream?.getTracks().forEach((track) => track.stop());
        if (nextMaterialUrl) {
          URL.revokeObjectURL(nextMaterialUrl);
          setMaterialUrl(null);
        }
        setPhase("setup");
        setSetupErrorLog(errorLog);
        const permissionDenied =
          startError instanceof DOMException &&
          (startError.name === "NotAllowedError" ||
            startError.name === "PermissionDeniedError");
        setSetupError(
          permissionDenied
            ? "마이크 권한이 필요합니다. 브라우저 주소창의 마이크 권한을 허용한 뒤 다시 연결하세요."
            : startError instanceof ApiError
              ? "자료를 분석하지 못했습니다. PDF/PPTX 파일과 API 설정을 확인한 뒤 다시 시도하세요."
              : "강의실을 열지 못했습니다. 마이크와 네트워크 상태를 확인해 주세요.",
        );
      } else {
        setPhase("live");
        setRuntimeErrorLog(errorLog);
        setTranscriptWarning(
          "실시간 음성 연결에 실패했습니다. 수업 세션은 유지되고 있습니다.",
        );
      }
    }
  };

  const returnToSetup = () => {
    realtime.disconnect();
    setSessionId(null);
    setSessionSeed(null);
    setPendingTranscriptIds(new Set());
    setLastAction("none");
    setNoActionVisible(false);
    setTranscriptWarning(null);
    setSetupErrorLog(null);
    setRuntimeErrorLog(null);
    setStartedAt(null);
    setElapsedSeconds(0);
    setDemoOpen(false);
    if (materialUrlRef.current) {
      URL.revokeObjectURL(materialUrlRef.current);
      setMaterialUrl(null);
    }
    setPhase("setup");
  };

  const sendDemoTranscript = async (text: string) => {
    if (!sessionId) return;
    setDemoError(null);
    debugSequenceRef.current += 1;
    const sent = await sendTranscript({
      itemId: `debug-${crypto.randomUUID()}`,
      sequence: debugSequenceRef.current,
      text,
      source: "typed",
      receivedAt: new Date().toISOString(),
    });
    if (!sent) {
      setDemoError("데모 문장을 보내지 못했습니다. 세션 상태를 확인해 주세요.");
    }
  };

  if (phase === "setup" || phase === "requesting-permission" || phase === "creating-session") {
    return (
      <SetupDesk
        phase={phase}
        file={materialFile}
        instruction={instruction}
        language={language}
        error={setupError}
        errorLog={setupErrorLog}
        onFile={(file) => {
          setMaterialFile(file);
          setSetupError(null);
        }}
        onInvalidFile={() => {
          const error = new Error("Only PDF and PPTX files are supported");
          setSetupError("PDF 또는 PPTX 파일만 사용할 수 있습니다.");
          setSetupErrorLog(
            captureClientError("material.validation", error),
          );
        }}
        onInstruction={setInstruction}
        onLanguage={setLanguage}
        onStart={() => void handleStart()}
      />
    );
  }

  if (!sessionId || !slideMap) {
    return (
      <main className={styles.fatalState}>
        <p>강의 자료 문맥을 불러오지 못했습니다.</p>
        <button type="button" onClick={returnToSetup}>처음으로 돌아가기</button>
      </main>
    );
  }

  return (
    <LiveWorkspace
      phase={effectivePhase}
      sessionId={sessionId}
      fileName={materialFile?.name ?? "자료 없는 실시간 강의"}
      materialUrl={materialUrl}
      slideMap={slideMap}
      sessionState={effectiveState}
      pollingDelayed={pollingDelayed}
      pendingCount={pendingTranscriptIds.size}
      lastAction={lastAction}
      noActionVisible={noActionVisible}
      elapsedSeconds={elapsedSeconds}
      realtime={realtime}
      warning={transcriptWarning}
      errorLog={runtimeErrorLog ?? realtime.errorLog ?? pollingErrorLog}
      demoEnabled={demoEnabled}
      demoOpen={demoOpen}
      demoError={demoError}
      onToggleDemo={() => setDemoOpen((open) => !open)}
      onDemoTranscript={(text) => void sendDemoTranscript(text)}
      onReturnToSetup={returnToSetup}
    />
  );
}

interface SetupDeskProps {
  phase: UiPhase;
  file: File | null;
  instruction: string;
  language: string;
  error: string | null;
  errorLog: ClientErrorLog | null;
  onFile: (file: File | null) => void;
  onInvalidFile: () => void;
  onInstruction: (instruction: string) => void;
  onLanguage: (language: string) => void;
  onStart: () => void;
}

function SetupDesk({
  phase,
  file,
  instruction,
  language,
  error,
  errorLog,
  onFile,
  onInvalidFile,
  onInstruction,
  onLanguage,
  onStart,
}: SetupDeskProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = phase !== "setup";
  const progressIndex = phase === "requesting-permission" ? 0 : phase === "creating-session" ? 1 : -1;

  const acceptFile = (candidate: File | null) => {
    if (!candidate) return;
    if (isSupportedMaterial(candidate)) {
      onFile(candidate);
    } else {
      onInvalidFile();
    }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0] ?? null);
  };

  const handleDropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const statusText = phase === "requesting-permission"
    ? "마이크를 사용할 수 있는지 확인하고 있습니다."
    : phase === "creating-session"
      ? file
        ? "자료의 구조와 핵심 주장을 읽고 있습니다."
        : "자료 없는 강의의 기본 문맥을 준비하고 있습니다."
      : "PDF나 PPTX를 올리거나, 자료 없이 바로 시작할 수 있습니다.";

  return (
    <main className={styles.setupPage}>
      <div className={styles.setupRule} aria-hidden="true" />
      <header className={styles.setupHeader}>
        <span className={styles.eyebrow}>LECTURE MARGIN / 01</span>
        <span className={styles.setupSignal}>MIC · CONTEXT · GROUNDING</span>
      </header>

      <section className={styles.setupIntro}>
        <div>
          <h1>LecturAI</h1>
          <p>수업의 여백까지 듣습니다.</p>
        </div>
        <p className={styles.setupDescription}>
          자료가 있든 없든 LecturAI가 강의 발화의 중요한 순간을 오른쪽
          여백에 조용히 남깁니다.
        </p>
      </section>

      <section className={styles.setupDesk} aria-busy={busy}>
        <div className={styles.uploadColumn}>
          <div
            className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""}`}
            role="button"
            tabIndex={0}
            aria-label="PDF 또는 PPTX 자료 선택"
            onClick={() => inputRef.current?.click()}
            onKeyDown={handleDropKey}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className={styles.visuallyHidden}
              type="file"
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
              onChange={handleInput}
              disabled={busy}
            />
            <span className={styles.dropIndex}>PDF · PPTX / OPTIONAL</span>
            <strong>자료를 책상 위에 올려두세요</strong>
            <span className={styles.dropHint}>
              끌어놓거나 Enter로 선택 · 자료 없이 시작 가능
            </span>
            {file ? (
              <span className={styles.fileSelection}>
                <span>{file.name}</span>
                <small>{formatBytes(file.size)}</small>
              </span>
            ) : (
              <span className={styles.paperCorner} aria-hidden="true" />
            )}
          </div>
          {file && !busy && (
            <button
              className={styles.clearMaterial}
              type="button"
              onClick={() => onFile(null)}
            >
              선택한 자료를 빼고 진행
            </button>
          )}
        </div>

        <div className={styles.instructionColumn}>
          <label className={styles.fieldLabel} htmlFor="instruction">
            <span>최초 지시문</span>
            <small>수업 전체에 한 번 적용됩니다</small>
          </label>
          <textarea
            id="instruction"
            value={instruction}
            onChange={(event) => onInstruction(event.target.value)}
            disabled={busy}
          />
          <div className={styles.setupControls}>
            <label htmlFor="language">
              <span>LANGUAGE</span>
              <select
                id="language"
                value={language}
                onChange={(event) => onLanguage(event.target.value)}
                disabled={busy}
              >
                <option value="ko">KO · 한국어 중심</option>
                <option value="en">EN · English</option>
              </select>
            </label>
            <button
              className={styles.startButton}
              type="button"
              onClick={onStart}
              disabled={busy}
            >
              <span>강의실 열기</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>

        <aside className={styles.setupLedger} aria-label="연결 순서">
          {["마이크 권한", file ? "자료 구조 읽기" : "기본 문맥 준비", "실시간 강의 연결"].map((label, index) => (
            <div
              key={label}
              className={index === progressIndex ? styles.ledgerActive : index < progressIndex ? styles.ledgerDone : ""}
            >
              <span>0{index + 1}</span>
              <p>{label}</p>
            </div>
          ))}
        </aside>
      </section>

      <div className={styles.setupStatus} aria-live="polite">
        <span className={busy ? styles.listeningDot : styles.statusDot} />
        <p>{statusText}</p>
      </div>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
      {errorLog && <ErrorLogDetails log={errorLog} />}
    </main>
  );
}

interface LiveWorkspaceProps {
  phase: UiPhase;
  sessionId: string;
  fileName: string;
  materialUrl: string | null;
  slideMap: SlideMapDto;
  sessionState: SessionStateDto | null;
  pollingDelayed: boolean;
  pendingCount: number;
  lastAction: TranscriptAction;
  noActionVisible: boolean;
  elapsedSeconds: number;
  realtime: ReturnType<typeof useRealtimeTranscription>;
  warning: string | null;
  errorLog: ClientErrorLog | null;
  demoEnabled: boolean;
  demoOpen: boolean;
  demoError: string | null;
  onToggleDemo: () => void;
  onDemoTranscript: (text: string) => void;
  onReturnToSetup: () => void;
}

function LiveWorkspace(props: LiveWorkspaceProps) {
  const {
    phase,
    sessionId,
    fileName,
    materialUrl,
    slideMap,
    sessionState,
    pollingDelayed,
    pendingCount,
    lastAction,
    noActionVisible,
    elapsedSeconds,
    realtime,
    warning,
    errorLog,
    demoEnabled,
    demoOpen,
    demoError,
    onToggleDemo,
    onDemoTranscript,
    onReturnToSetup,
  } = props;

  const currentPage = sessionState?.currentSlidePage ?? null;
  const currentSlide = slideMap.slides.find((slide) => slide.page === currentPage) ?? null;
  const events = sessionState?.events ?? [];
  const transcripts = sessionState?.transcripts ?? [];
  const review = sessionState?.review ?? null;
  const latestVerification = [...events]
    .reverse()
    .find((event): event is VerificationEventDto => event.type === "verification");
  const searching = events.some(
    (event) => event.type === "verification" && event.status === "searching",
  );

  const micStatus = realtime.connectionPhase === "error"
    ? "ERROR"
    : realtime.speaking
      ? "SPEECH"
      : realtime.connectionPhase === "connecting"
        ? "CONNECTING"
        : realtime.connectionPhase === "idle"
          ? "OFF"
          : "LIVE";
  const transcriptStatus = realtime.speaking
    ? "DETECTING"
    : realtime.connectionPhase === "listening"
      ? "READY"
      : realtime.connectionPhase.toUpperCase();
  const agentStatus = phase === "ended"
    ? "ENDED"
    : phase === "connecting-realtime"
      ? "CONNECTING"
    : pendingCount > 0
      ? "COMPARING"
      : "WATCHING";
  const toolStatus = searching
    ? "SEARCHING"
    : latestVerification?.status === "complete"
      ? "GROUNDED"
      : latestVerification?.status === "failed"
        ? "CHECK"
        : lastAction === "mark_emphasis"
          ? "MARKED"
          : "QUIET";

  const statusSentence = pollingDelayed
    ? "수업 상태 동기화가 잠시 지연되고 있습니다."
    : phase === "ended"
      ? "수업이 끝났습니다. 복습 노트를 정리했습니다."
      : phase === "connecting-realtime"
        ? "마이크와 강의실을 연결하고 있습니다."
      : searching
        ? "외부 근거를 찾고 있습니다."
        : pendingCount > 0
          ? "방금 문장을 자료와 대조하고 있습니다."
          : lastAction === "verify_claim_with_liner" &&
              latestVerification?.status === "complete"
            ? "근거 확인을 마쳤습니다."
          : realtime.connectionPhase === "error"
            ? "실시간 연결은 멈췄지만 수업 세션은 유지되고 있습니다."
            : "강의의 맥락을 맞추고 있습니다.";

  return (
    <main className={`${styles.workspace} ${phase === "ended" ? styles.workspaceEnded : ""}`}>
      <SignalRail
        title={slideMap.documentTitle || fileName}
        elapsed={elapsedSeconds}
        mic={micStatus}
        transcript={transcriptStatus}
        agent={agentStatus}
        tool={toolStatus}
        statusSentence={statusSentence}
        sessionId={sessionId}
        onReturnToSetup={onReturnToSetup}
      />

      <div className={styles.lectureGrid}>
        <PageRail slides={slideMap.slides} currentPage={currentPage} />
        <SlideContextSheet
          slideMap={slideMap}
          slide={currentSlide}
          currentPage={currentPage}
          materialUrl={materialUrl}
          noMaterialMode={!materialUrl}
        />
        <AgentMargin
          events={events}
          noActionVisible={noActionVisible}
          ended={phase === "ended"}
        />
      </div>

      <TranscriptRibbon
        meterLevels={realtime.meterLevels}
        speaking={realtime.speaking}
        partials={realtime.partialTranscripts}
        localFinals={realtime.recentFinals.map((item) => item.text)}
        serverFinals={transcripts.slice(-3).map((item) => item.text)}
        warning={realtime.warning ?? realtime.error ?? warning}
      />

      <div className={styles.liveSentence} aria-live="polite">
        <span className={pollingDelayed ? styles.delayDot : styles.statusDot} />
        {statusSentence}
      </div>

      {errorLog && <ErrorLogDetails log={errorLog} compact />}

      {review && phase === "ended" && <ReviewSheet review={review} />}

      {demoEnabled && (
        <DemoFallbackDrawer
          open={demoOpen}
          busy={pendingCount > 0}
          error={demoError}
          onToggle={onToggleDemo}
          onSend={onDemoTranscript}
        />
      )}
    </main>
  );
}

function SignalRail({
  title,
  elapsed,
  mic,
  transcript,
  agent,
  tool,
  statusSentence,
  sessionId,
  onReturnToSetup,
}: {
  title: string;
  elapsed: number;
  mic: string;
  transcript: string;
  agent: string;
  tool: string;
  statusSentence: string;
  sessionId: string;
  onReturnToSetup: () => void;
}) {
  const signals = [
    ["MIC", mic],
    ["TRANSCRIPT", transcript],
    ["AGENT", agent],
    ["TOOL", tool],
  ];

  return (
    <header className={styles.signalRail}>
      <button className={styles.railBrand} type="button" onClick={onReturnToSetup}>
        LecturAI
      </button>
      <div className={styles.railDocument} title={title}>{title}</div>
      <time className={styles.elapsed}>{formatElapsed(elapsed)}</time>
      <div className={styles.signalSequence} aria-label={statusSentence}>
        {signals.map(([label, value], index) => (
          <div key={label} className={styles.signalItem}>
            <span>{label}</span>
            <strong>{value}</strong>
            {index < signals.length - 1 && <i aria-hidden="true" />}
          </div>
        ))}
      </div>
      <button
        className={styles.rawButton}
        type="button"
        onClick={() => window.open(`/raw/${sessionId}`, "_blank", "noopener,noreferrer")}
      >
        RAW ↗
      </button>
    </header>
  );
}

function PageRail({ slides, currentPage }: { slides: SlideDto[]; currentPage: number | null }) {
  return (
    <nav className={styles.pageRail} aria-label="슬라이드 목차">
      <span className={styles.sectionLabel}>PAGE RAIL</span>
      <ol>
        {slides.map((slide) => (
          <li
            key={slide.page}
            className={slide.page === currentPage ? styles.currentPage : ""}
            aria-current={slide.page === currentPage ? "page" : undefined}
          >
            <span>{String(slide.page).padStart(2, "0")}</span>
            <p>{slide.title || `Page ${slide.page}`}</p>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SlideContextSheet({
  slideMap,
  slide,
  currentPage,
  materialUrl,
  noMaterialMode,
}: {
  slideMap: SlideMapDto;
  slide: SlideDto | null;
  currentPage: number | null;
  materialUrl: string | null;
  noMaterialMode: boolean;
}) {
  const total = slideMap.slides.length;
  return (
    <section className={styles.slideStage} aria-label="AI가 읽은 자료 문맥">
      <div className={styles.sheetShadow} aria-hidden="true" />
      <article className={styles.contextSheet} key={currentPage ?? "document"}>
        <header className={styles.sheetHeader}>
          <div>
            <span>AI가 읽은 자료 문맥</span>
            <small>DOCUMENT GROUND</small>
          </div>
          <div className={styles.pageCount}>
            PAGE {currentPage ?? "—"} / {total || "—"}
          </div>
        </header>

        {slide ? (
          <div className={styles.sheetBody}>
            <h1>{slide.title || `Page ${slide.page}`}</h1>
            <p className={styles.slideSummary}>{slide.summary}</p>
            <div className={styles.paperDivider} />
            {slide.keyConcepts.length > 0 && (
              <section className={styles.concepts}>
                <h2>핵심 개념</h2>
                <ul>
                  {slide.keyConcepts.map((concept) => (
                    <li key={concept}>{concept}</li>
                  ))}
                </ul>
              </section>
            )}
            {slide.factualClaims.length > 0 ? (
              <section className={styles.claims}>
                <h2>자료에 적힌 주장</h2>
                <ol>
                  {slide.factualClaims.map((claim) => (
                    <li key={claim.id}>
                      <span>{claim.type}</span>
                      <p>{claim.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : noMaterialMode ? (
              <div className={styles.noMaterialNotice}>
                <span>NO SLIDE EVIDENCE</span>
                <p>
                  자료와의 충돌 검증 없이 발화의 명시적 강조와 수업 종료를
                  모니터링합니다.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.sheetBody}>
            <h1>{slideMap.documentTitle}</h1>
            <p className={styles.slideSummary}>{slideMap.documentSummary}</p>
            <div className={styles.documentKeywords}>
              {slideMap.globalKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
          </div>
        )}

        <footer className={styles.sheetFooter}>
          <span>LECTURAI / READ CONTEXT</span>
          {materialUrl && (
            <button
              type="button"
              onClick={() =>
                window.open(materialUrl, "_blank", "noopener,noreferrer")
              }
            >
              원본 자료 열기 ↗
            </button>
          )}
        </footer>
        <span className={styles.sheetFold} aria-hidden="true" />
      </article>
    </section>
  );
}

function AgentMargin({
  events,
  noActionVisible,
  ended,
}: {
  events: LectureEventDto[];
  noActionVisible: boolean;
  ended: boolean;
}) {
  return (
    <aside className={styles.agentMargin} aria-label="조교의 실시간 여백">
      <header>
        <span className={styles.sectionLabel}>AGENT MARGIN</span>
        <p>조교가 남긴 실시간 주석</p>
      </header>
      <div className={styles.marginFeed} role="feed" aria-live="polite">
        {events.length === 0 && !ended ? (
          <div className={styles.emptyMargin}>
            <span>NO INTERVENTION</span>
            <p>아직 개입할 이유가 없습니다.<br />강의 문맥만 계속 맞추고 있습니다.</p>
          </div>
        ) : (
          events.map((event) => (
            event.type === "emphasis"
              ? <EmphasisNote key={event.id} event={event} />
              : <VerificationNote key={event.id} event={event} />
          ))
        )}
        {noActionVisible && (
          <div className={styles.noActionNote}>NO ACTION · 문맥만 갱신</div>
        )}
        {ended && (
          <div className={styles.lessonEndNote}>
            <span>LESSON CLOSED</span>
            <p>수업 종료를 감지했습니다. 복습지를 펼칩니다.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function EmphasisNote({ event }: { event: EmphasisEventDto }) {
  return (
    <article className={styles.emphasisNote}>
      <NoteMeta label="EMPHASIS" page={event.slidePage} time={event.createdAt} />
      <blockquote>{event.quote}</blockquote>
      <p className={styles.noteConcept}>{event.concept}</p>
      <small>교수가 여기에 밑줄을 그었습니다.</small>
    </article>
  );
}

function VerificationNote({ event }: { event: VerificationEventDto }) {
  const complete = event.status === "complete";
  const failed = event.status === "failed";
  const label = complete
    ? "GROUNDED"
    : failed
      ? "ADDITIONAL CHECK NEEDED"
      : "CONFLICT DETECTED";
  return (
    <article
      className={`${styles.verificationNote} ${complete ? styles.verificationComplete : ""} ${failed ? styles.verificationFailed : ""}`}
    >
      <NoteMeta label={label} page={event.slidePage} time={event.updatedAt} />
      <div className={styles.claimPair}>
        <div>
          <span>LECTURE</span>
          <p>{event.lectureClaim}</p>
        </div>
        <div>
          <span>SLIDE</span>
          <p>{event.slideClaim}</p>
        </div>
      </div>
      {event.query && <p className={styles.searchQuery}>SEARCH / {event.query}</p>}
      <div className={styles.verificationTrack} aria-label={`검증 상태 ${event.status}`}>
        <span className={styles.trackReached}>DETECTED</span>
        <i />
        <span className={styles.trackReached}>SEARCHING</span>
        <i />
        <span className={complete ? styles.trackReached : failed ? styles.trackFailed : ""}>
          GROUNDED
        </span>
      </div>
      {event.status === "searching" ? (
        <div className={styles.scanner}>
          <span aria-hidden="true" />
          <p>Liner에서 외부 근거를 찾고 있습니다.</p>
        </div>
      ) : (
        <div className={styles.verificationResult}>
          {event.verdict && <strong>{formatVerdict(event.verdict)}</strong>}
          <p>{event.explanation}</p>
          {event.correctedStatement && (
            <blockquote>{event.correctedStatement}</blockquote>
          )}
        </div>
      )}
      {event.sources.length > 0 && (
        <ol className={styles.sources}>
          {event.sources.slice(0, 3).map((source, index) => (
            <li key={`${source.url}-${index}`}>
              <span>0{index + 1}</span>
              <a href={source.url} target="_blank" rel="noreferrer">
                <strong>{source.title}</strong>
                <small>{source.hostname} ↗</small>
              </a>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function NoteMeta({ label, page, time }: { label: string; page: number; time: string }) {
  return (
    <header className={styles.noteMeta}>
      <strong>{label}</strong>
      <span>PAGE {page} · {formatClock(time)}</span>
    </header>
  );
}

function TranscriptRibbon({
  meterLevels,
  speaking,
  partials,
  localFinals,
  serverFinals,
  warning,
}: {
  meterLevels: number[];
  speaking: boolean;
  partials: ReadonlyMap<string, string>;
  localFinals: string[];
  serverFinals: string[];
  warning: string | null;
}) {
  const activePartial = Array.from(partials.entries()).at(-1)?.[1] ?? "";
  const finals = localFinals.length > 0 ? localFinals : serverFinals;
  return (
    <section className={styles.transcriptRibbon} aria-label="실시간 자막">
      <div className={`${styles.audioMeter} ${speaking ? styles.audioMeterSpeaking : ""}`}>
        <span className={styles.liveLabel}>{speaking ? "SPEECH" : "LIVE"}</span>
        <div aria-label="마이크 음량">
          {meterLevels.map((level, index) => (
            <i
              key={index}
              style={{ transform: `scaleY(${Math.max(0.08, level)})` }}
            />
          ))}
        </div>
      </div>
      <div className={styles.transcriptText} aria-live="polite">
        <div className={styles.recentTranscripts}>
          {finals.slice(-3, -1).map((text, index) => (
            <p key={`${text}-${index}`}>{text}</p>
          ))}
        </div>
        <p className={styles.currentTranscript}>
          {activePartial || finals.at(-1) || "말을 시작하면 이곳에 강의 자막이 흐릅니다."}
          {activePartial && <span className={styles.caret} aria-hidden="true" />}
        </p>
        {warning && <small role="status">{warning}</small>}
      </div>
      <div className={styles.ribbonIndex}>
        <span>TRANSCRIPTION</span>
        <strong>{String(partials.size).padStart(2, "0")}</strong>
      </div>
    </section>
  );
}

function ReviewSheet({ review }: { review: ReviewDto }) {
  return (
    <section className={styles.reviewBackdrop} aria-label="복습 문제">
      <article className={styles.reviewSheet}>
        <header>
          <div>
            <span>REVIEW SHEET / 03</span>
            <h2>오늘 남겨야 할 세 가지</h2>
          </div>
          <time>{formatDate(review.generatedAt)}</time>
        </header>
        <div className={styles.reviewQuestions}>
          {review.questions.map((question, index) => (
            <section
              key={`${question.question}-${index}`}
              style={{ animationDelay: `${index * 120 + 120}ms` }}
            >
              <span className={styles.questionNumber}>0{index + 1}</span>
              <div>
                <h3>{question.question}</h3>
                {question.choices.length > 0 && (
                  <ol className={styles.choices}>
                    {question.choices.map((choice, choiceIndex) => (
                      <li key={`${choice}-${choiceIndex}`}>{choice}</li>
                    ))}
                  </ol>
                )}
                <p className={styles.answer}><span>ANSWER</span>{question.answer}</p>
                <p className={styles.explanation}>{question.explanation}</p>
                <small>SLIDE PAGE {question.slidePage}</small>
              </div>
            </section>
          ))}
        </div>
      </article>
    </section>
  );
}

function DemoFallbackDrawer({
  open,
  busy,
  error,
  onToggle,
  onSend,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onToggle: () => void;
  onSend: (text: string) => void;
}) {
  return (
    <aside className={`${styles.demoDrawer} ${open ? styles.demoDrawerOpen : ""}`}>
      <button className={styles.demoTab} type="button" onClick={onToggle}>
        {open ? "CLOSE DEMO" : "DEMO"}
      </button>
      {open && (
        <div>
          <header>
            <span>EMERGENCY INPUT</span>
            <p>실제 transcript API를 통과합니다.</p>
          </header>
          {DEMO_PRESETS.map(([label, text]) => (
            <button key={label} type="button" disabled={busy} onClick={() => onSend(text)}>
              <span>{label}</span>
              <small>{text}</small>
            </button>
          ))}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </aside>
  );
}

function ErrorLogDetails({
  log,
  compact = false,
}: {
  log: ClientErrorLog;
  compact?: boolean;
}) {
  const rawSessionId = getSessionIdFromPayload(log.payload);
  return (
    <details
      className={`${styles.errorLogPanel} ${compact ? styles.errorLogCompact : ""}`}
    >
      <summary>
        ERROR LOG · {log.scope}
        {log.status ? ` · HTTP ${log.status}` : ""}
      </summary>
      {rawSessionId && (
        <a
          href={`/raw/${encodeURIComponent(rawSessionId)}`}
          target="_blank"
          rel="noreferrer"
        >
          OPEN SESSION RAW ↗
        </a>
      )}
      <pre>{JSON.stringify(log, null, 2)}</pre>
    </details>
  );
}

function getSessionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("sessionId" in payload)) {
    return null;
  }
  return typeof payload.sessionId === "string" ? payload.sessionId : null;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatClock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--:--"
    : new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
      }).format(date);
}

function formatVerdict(verdict: VerificationEventDto["verdict"]): string {
  const labels: Record<NonNullable<VerificationEventDto["verdict"]>, string> = {
    supports_slide: "자료의 설명을 지지하는 근거",
    supports_lecture: "강의 발화를 지지하는 근거",
    mixed: "근거가 엇갈림",
    insufficient: "근거가 충분하지 않음",
  };
  return verdict ? labels[verdict] : "";
}
