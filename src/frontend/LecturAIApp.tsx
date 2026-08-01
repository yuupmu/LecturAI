"use client";

import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { StructuredNotesPanel } from "@/components/lecturai/StructuredNotesPanel";
import { TranscriptNotebook } from "@/components/lecturai/TranscriptNotebook";
import { TranslationControl } from "@/components/lecturai/TranslationControl";
import { LivePdfViewer } from "@/components/lecturai/LivePdfViewer";
import { AbsenceToggle } from "@/components/lecturai/AbsenceToggle";
import { MissedFlowControl } from "@/components/lecturai/MissedFlowControl";
import { EndingCandidateBanner } from "@/components/lecturai/EndingCandidateBanner";
import { LectureQuestionDock } from "@/components/lecturai/LectureQuestionDock";
import { ParallelLecturePanel } from "@/components/lecturai/ParallelLecturePanel";
import { SelectionExplanationModal } from "@/components/lecturai/SelectionExplanationModal";
import {
  ApiError,
  askLectureQuestion,
  askTranscriptSelection,
  cancelAutomaticEnding,
  checkDeferredQuestion,
  createDeferredQuestion,
  createSession,
  endLectureAbsence,
  explainDeferredQuestion,
  generateLectureNote,
  postTranscript,
  rejoinUnderstandingBranch,
  requestMissedFlowRecovery,
  sendUnderstandingBranchMessage,
  setAutomaticLectureNotes,
  setTranslationSettings,
  startUnderstandingBranch,
  startLectureAbsence,
  updateDeferredQuestion,
} from "./api";
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
  TranscriptDto,
  TranscriptInputDto,
  TranscriptSelectionDto,
  TranslationSettingsDto,
  TranslationTargetLanguageDto,
  UnderstandingBranchDto,
  UiPhase,
  VerificationEventDto,
} from "./types";
import {
  useRealtimeTranscription,
  type RealtimeFinalTranscript,
} from "./useRealtimeTranscription";
import { useSessionPolling } from "./useSessionPolling";
import { useTestAudioInput } from "./useTestAudioInput";
import { useTestTextInput } from "./useTestTextInput";

const DEFAULT_INSTRUCTION = `이 자료와 수업 대본을 바탕으로 강의의 의미와 흐름을 계속 해석해줘.
완성되지 않은 설명은 기다리고, 의미적 단원이 충분히 끝났을 때만
자료와 대본에 근거한 복습용 구조화 필기를 만들어줘.`;

const DEMO_PRESETS = [
  ["번역 · 한국어 원문", "이진 탐색은 정렬된 배열에서 탐색 범위를 절반씩 줄이는 알고리즘입니다."],
  ["번역 · 영어 원문", "Binary search requires the array to be sorted before the search begins."],
  ["번역 · 수식 보존", "The worst-case time complexity is O(log n), not O(n)."],
  ["슬라이드 1 설명", "이진 탐색은 정렬된 배열에서 원하는 값을 찾는 알고리즘입니다."],
  ["다음 슬라이드 전환", "이제 이진 탐색의 시간복잡도를 살펴보겠습니다. 탐색 범위를 매번 절반씩 줄입니다."],
  ["필기용 예시", "전화번호부를 펼쳐 가운데부터 이름을 찾는 방식으로 생각하면 됩니다. 찾는 이름이 뒤쪽이면 앞 절반은 버릴 수 있습니다."],
  ["강조 문맥", "이진 탐색은 정렬된 배열에서 사용하고, 탐색 범위를 매번 절반씩 줄입니다."],
  ["문맥 참조 강조", "방금 말한 두 가지는 시험에 꼭 나오니 반드시 기억하세요."],
  ["부정 강조", "이 내용은 중요하지 않고 시험에도 나오지 않습니다."],
  ["불일치 문장", "이진 탐색의 최악 시간복잡도는 O(n)입니다."],
  ["종료", "오늘 수업은 여기까지 하겠습니다."],
] as const;

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const DEMO_MATERIAL_URL = "/demo/binary_search_demo_slides.pdf";
type DemoLanguage = "ko" | "en";

const DEMO_SCRIPTS: Record<
  DemoLanguage,
  { url: string; filename: string; label: string }
> = {
  ko: {
    url: "/demo/binary_search_lecture_script_ko.txt",
    filename: "binary_search_lecture_script_ko.txt",
    label: "한국어",
  },
  en: {
    url: "/demo/binary_search_lecture_script_en.txt",
    filename: "binary_search_lecture_script_en.txt",
    label: "English",
  },
};

function isSupportedMaterial(file: File): boolean {
  const filename = file.name.toLocaleLowerCase();
  return (
    file.type === "application/pdf" ||
    file.type === PPTX_MIME_TYPE ||
    filename.endsWith(".pdf") ||
    filename.endsWith(".pptx")
  );
}

function isSupportedTestAudio(file: File): boolean {
  return file.type === "audio/mpeg" || file.name.toLocaleLowerCase().endsWith(".mp3");
}

function isSupportedTestText(file: File): boolean {
  return file.type === "text/plain" || file.name.toLocaleLowerCase().endsWith(".txt");
}

function isSupportedTestInput(file: File): boolean {
  return isSupportedTestAudio(file) || isSupportedTestText(file);
}

// LecturAIApp owns the intentionally local, single-session demo state.
export default function LecturAIApp() {
  const searchParams = useSearchParams();
  const [demoScriptFile, setDemoScriptFile] = useState<File | null>(null);
  const [demoLanguage, setDemoLanguage] = useState<DemoLanguage | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const demoEnabled =
    process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTROLS === "true" ||
    searchParams.get("debug") === "1" ||
    demoScriptFile !== null;
  const [phase, setPhase] = useState<UiPhase>("setup");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [testAudioFile, setTestAudioFile] = useState<File | null>(null);
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
  const [transcriptWarning, setTranscriptWarning] = useState<string | null>(null);
  const [runtimeErrorLog, setRuntimeErrorLog] =
    useState<ClientErrorLog | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
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
        await postTranscript(sessionId, transcript);
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
  const testAudio = useTestAudioInput();
  const handleTestTextSentence = useCallback(
    async (text: string) => {
      debugSequenceRef.current += 1;
      return sendTranscript({
        itemId: `txt-demo-${crypto.randomUUID()}`,
        sequence: debugSequenceRef.current,
        text,
        source: "manual",
        receivedAt: new Date().toISOString(),
      });
    },
    [sendTranscript],
  );
  const testText = useTestTextInput({ onSentence: handleTestTextSentence });
  const disconnectRealtime = realtime.disconnect;
  const stopTestAudio = testAudio.stop;
  const stopTestText = testText.stop;

  const effectiveState = polledState;
  const slideMap = effectiveState?.slideMap ?? sessionSeed?.slideMap ?? null;
  const lessonEnded = effectiveState?.status === "ended";
  const lessonFinalizing = effectiveState?.status === "finalizing";
  const effectivePhase: UiPhase = lessonEnded ? "ended" : phase;
  useEffect(() => {
    materialUrlRef.current = materialUrl;
  }, [materialUrl]);

  useEffect(
    () => () => {
      if (materialUrlRef.current) URL.revokeObjectURL(materialUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!lessonEnded && !lessonFinalizing) return;
    disconnectRealtime();
    stopTestAudio();
    stopTestText();
  }, [disconnectRealtime, lessonEnded, lessonFinalizing, stopTestAudio, stopTestText]);

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
    let startStage: "input" | "session" | "realtime" | "playback" = "input";
    const selectedTestAudio = demoEnabled ? testAudioFile : null;
    const usingTestText = selectedTestAudio !== null && isSupportedTestText(selectedTestAudio);
    const usingTestAudio = selectedTestAudio !== null && !usingTestText;
    setSetupError(null);
    setSetupErrorLog(null);
    setTranscriptWarning(null);
    setRuntimeErrorLog(null);
    setPhase("requesting-permission");

    try {
      if (usingTestText && selectedTestAudio) {
        await testText.prepare(selectedTestAudio);
      } else {
        stream = selectedTestAudio
          ? await testAudio.prepare(selectedTestAudio)
          : await navigator.mediaDevices.getUserMedia({ audio: true });
      }
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
      startStage = "session";
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
      startStage = "realtime";
      if (usingTestText) {
        startStage = "playback";
        testText.play();
      } else {
        if (!stream) throw new Error("실시간 입력 스트림이 준비되지 않았습니다.");
        await realtime.connect(created.sessionId, stream);
        if (usingTestAudio) {
          startStage = "playback";
          await testAudio.play();
        }
      }
      setPhase("live");
    } catch (startError) {
      if (startStage === "playback") realtime.disconnect();
      if (usingTestAudio) testAudio.stop();
      if (usingTestText) testText.stop();
      const errorLog = captureClientError("lecture.start", startError);
      const configurationFailure =
        startError instanceof ApiError && startError.status === 503;
      if (!created || configurationFailure) {
        if (configurationFailure) {
          realtime.disconnect();
          setSessionId(null);
          setSessionSeed(null);
          setStartedAt(null);
          setElapsedSeconds(0);
        }
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
          usingTestText && startStage === "input"
            ? "TXT 테스트 입력을 준비하지 못했습니다. 파일 내용과 인코딩을 확인해 주세요."
            : usingTestAudio && startStage === "input"
              ? "MP3 테스트 입력을 준비하지 못했습니다. 파일 형식과 브라우저 오디오 지원을 확인해 주세요."
            : permissionDenied
            ? "마이크 권한이 필요합니다. 브라우저 주소창의 마이크 권한을 허용한 뒤 다시 연결하세요."
            : startError instanceof ApiError
              ? configurationFailure
                ? startError.message
                : "자료를 분석하지 못했습니다. PDF/PPTX 파일과 API 설정을 확인한 뒤 다시 시도하세요."
              : "강의실을 열지 못했습니다. 마이크와 네트워크 상태를 확인해 주세요.",
        );
      } else {
        setPhase("live");
        setRuntimeErrorLog(errorLog);
        setTranscriptWarning(
          usingTestText && startStage === "playback"
            ? "TXT 테스트 입력을 순차 재생하지 못했습니다. 수업 세션은 유지되고 있습니다."
            : usingTestAudio && startStage === "playback"
              ? "MP3 테스트 입력을 실시간 연결에 재생하지 못했습니다. 수업 세션은 유지되고 있습니다."
            : "실시간 음성 연결에 실패했습니다. 수업 세션은 유지되고 있습니다.",
        );
      }
    }
  };

  const returnToSetup = () => {
    realtime.disconnect();
    testAudio.stop();
    testText.stop();
    setSessionId(null);
    setSessionSeed(null);
    setPendingTranscriptIds(new Set());
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
      source: "manual",
      receivedAt: new Date().toISOString(),
    });
    if (!sent) {
      setDemoError("데모 문장을 보내지 못했습니다. 세션 상태를 확인해 주세요.");
    }
  };

  const loadDemoData = async (selectedDemoLanguage: DemoLanguage) => {
    setDemoLoading(true);
    setSetupError(null);
    setSetupErrorLog(null);
    try {
      const selectedScript = DEMO_SCRIPTS[selectedDemoLanguage];
      const [materialResponse, scriptResponse] = await Promise.all([
        fetch(DEMO_MATERIAL_URL, { cache: "no-store" }),
        fetch(selectedScript.url, { cache: "no-store" }),
      ]);
      if (!materialResponse.ok || !scriptResponse.ok) {
        throw new Error("Demo assets could not be loaded");
      }
      const [materialBlob, scriptText] = await Promise.all([
        materialResponse.blob(),
        scriptResponse.text(),
      ]);
      setMaterialFile(
        new File([materialBlob], "binary_search_demo_slides.pdf", {
          type: "application/pdf",
        }),
      );
      const scriptFile = new File(
        [scriptText],
        selectedScript.filename,
        { type: "text/plain" },
      );
      setDemoScriptFile(scriptFile);
      setDemoLanguage(selectedDemoLanguage);
      setTestAudioFile(scriptFile);
      setLanguage(selectedDemoLanguage);
    } catch (error) {
      setSetupError("데모 자료를 불러오지 못했습니다. 정적 파일 경로를 확인해 주세요.");
      setSetupErrorLog(captureClientError("demo.load", error));
    } finally {
      setDemoLoading(false);
    }
  };

  if (phase === "setup" || phase === "requesting-permission" || phase === "creating-session") {
    return (
      <SetupDesk
        phase={phase}
        file={materialFile}
        demoEnabled={demoEnabled}
        demoLoading={demoLoading}
        demoScriptFile={demoScriptFile}
        demoLanguage={demoLanguage}
        testAudioFile={testAudioFile}
        instruction={instruction}
        language={language}
        error={setupError}
        errorLog={setupErrorLog}
        onFile={(file) => {
          setMaterialFile(file);
          setDemoScriptFile(null);
          setDemoLanguage(null);
          setSetupError(null);
        }}
        onInvalidFile={() => {
          const error = new Error("Only PDF and PPTX files are supported");
          setSetupError("PDF 또는 PPTX 파일만 사용할 수 있습니다.");
          setSetupErrorLog(
            captureClientError("material.validation", error),
          );
        }}
        onTestAudioFile={(file) => {
          setTestAudioFile(file);
          setSetupError(null);
          setSetupErrorLog(null);
        }}
        onInvalidTestAudio={() => {
          const error = new Error("Only MP3 and TXT test inputs are supported");
          setSetupError("개발자 테스트 입력은 MP3 또는 TXT 파일만 사용할 수 있습니다.");
          setSetupErrorLog(captureClientError("test_audio.validation", error));
        }}
        onInstruction={setInstruction}
        onLanguage={setLanguage}
        onStart={() => void handleStart()}
        onLoadDemo={(selectedDemoLanguage) => void loadDemoData(selectedDemoLanguage)}
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
      materialIsPdf={
        materialFile !== null &&
        (materialFile.type === "application/pdf" ||
          materialFile.name.toLocaleLowerCase().endsWith(".pdf"))
      }
      slideMap={slideMap}
      sessionState={effectiveState}
      pollingDelayed={pollingDelayed}
      pendingCount={pendingTranscriptIds.size}
      elapsedSeconds={elapsedSeconds}
      realtime={realtime}
      testAudio={testAudio}
      testAudioFileName={testAudioFile && isSupportedTestAudio(testAudioFile) ? testAudioFile.name : null}
      testText={testText}
      testTextFileName={testAudioFile && isSupportedTestText(testAudioFile) ? testAudioFile.name : null}
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
  demoEnabled: boolean;
  demoLoading: boolean;
  demoScriptFile: File | null;
  demoLanguage: DemoLanguage | null;
  testAudioFile: File | null;
  instruction: string;
  language: string;
  error: string | null;
  errorLog: ClientErrorLog | null;
  onFile: (file: File | null) => void;
  onInvalidFile: () => void;
  onTestAudioFile: (file: File | null) => void;
  onInvalidTestAudio: () => void;
  onInstruction: (instruction: string) => void;
  onLanguage: (language: string) => void;
  onStart: () => void;
  onLoadDemo: (language: DemoLanguage) => void;
}

function SetupDesk({
  phase,
  file,
  demoEnabled,
  demoLoading,
  demoScriptFile,
  demoLanguage,
  testAudioFile,
  instruction,
  language,
  error,
  errorLog,
  onFile,
  onInvalidFile,
  onTestAudioFile,
  onInvalidTestAudio,
  onInstruction,
  onLanguage,
  onStart,
  onLoadDemo,
}: SetupDeskProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [demoLanguageOpen, setDemoLanguageOpen] = useState(false);
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

  const handleTestAudioInput = (event: ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!candidate) return;
    if (isSupportedTestInput(candidate)) onTestAudioFile(candidate);
    else onInvalidTestAudio();
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
    ? testAudioFile
      ? isSupportedTestText(testAudioFile)
        ? "TXT 원고를 문장 단위 실시간 입력으로 준비하고 있습니다."
        : "MP3를 실시간 테스트 오디오 스트림으로 준비하고 있습니다."
      : "마이크를 사용할 수 있는지 확인하고 있습니다."
    : phase === "creating-session"
      ? file
        ? "자료의 구조와 핵심 주장을 읽고 있습니다."
        : "자료 없는 강의의 기본 문맥을 준비하고 있습니다."
      : demoScriptFile
        ? `이진 탐색 데모 자료와 ${demoLanguage ? DEMO_SCRIPTS[demoLanguage].label : "선택한"} 강의 원고가 준비되었습니다.`
      : testAudioFile
        ? isSupportedTestText(testAudioFile)
          ? "TXT가 선택되었습니다. 시작하면 문장이 녹음 자막처럼 차례로 입력됩니다."
          : "MP3가 선택되었습니다. 시작하면 마이크 대신 실시간 속도로 재생합니다."
        : "PDF나 PPTX를 올리거나, 자료 없이 바로 시작할 수 있습니다.";

  return (
    <main className={styles.setupPage}>
      <div className={styles.setupRule} aria-hidden="true" />
      <header className={styles.setupHeader}>
        <span className={styles.eyebrow}>LECTURE MARGIN / 01</span>
        <div className={styles.setupHeaderRight}>
          <div className={styles.demoLoadMenu}>
            <button
              className={styles.demoLoadButton}
              type="button"
              aria-label="이진 탐색 데모 대본 언어 선택"
              aria-expanded={demoLanguageOpen}
              aria-haspopup="menu"
              onClick={() => setDemoLanguageOpen((open) => !open)}
              disabled={busy || demoLoading}
            >
              {demoLoading ? "DEMO LOADING…" : demoScriptFile ? "DEMO READY · CHANGE" : "DEMO DATA ↗"}
            </button>
            {demoLanguageOpen && !busy && !demoLoading && (
              <div className={styles.demoLanguageMenu} role="menu" aria-label="데모 대본 언어">
                <span>TEST SCRIPT</span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDemoLanguageOpen(false);
                    onLoadDemo("ko");
                  }}
                >
                  <strong>한국어</strong>
                  <small>기본 기능 확인</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDemoLanguageOpen(false);
                    onLoadDemo("en");
                  }}
                >
                  <strong>English</strong>
                  <small>영어 대본 처리 테스트</small>
                </button>
              </div>
            )}
          </div>
          <span className={styles.setupSignal}>MIC · CONTEXT · GROUNDING</span>
        </div>
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
          {demoScriptFile && (
            <div className={styles.demoAssetMeta}>
              <span>DEMO SCRIPT LOADED</span>
              <small>
                {formatBytes(demoScriptFile.size)} · {demoLanguage ? DEMO_SCRIPTS[demoLanguage].label : "선택한"} 강의 원고 · {" "}
                {demoLanguage && (
                  <a href={DEMO_SCRIPTS[demoLanguage].url} target="_blank" rel="noreferrer">원고 열기 ↗</a>
                )}
              </small>
            </div>
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
          {demoEnabled && (
            <div className={styles.testAudioPicker}>
              <div>
                <span>DEV INPUT · MP3 / TXT</span>
                <small>MP3는 Realtime 전송 · TXT는 문장별 실시간 자막 입력</small>
              </div>
              <label>
                <input
                  className={styles.visuallyHidden}
                  type="file"
                  accept="audio/mpeg,.mp3,text/plain,.txt"
                  onChange={handleTestAudioInput}
                  disabled={busy}
                />
                <span>{testAudioFile ? "입력 교체" : "MP3/TXT 선택"}</span>
              </label>
              {testAudioFile && (
                <div className={styles.testAudioSelection}>
                  <span title={testAudioFile.name}>{testAudioFile.name}</span>
                  <small>{formatBytes(testAudioFile.size)}</small>
                  <button
                    type="button"
                    onClick={() => onTestAudioFile(null)}
                    disabled={busy}
                  >
                    제거
                  </button>
                </div>
              )}
            </div>
          )}
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
          {[
            testAudioFile
              ? isSupportedTestText(testAudioFile)
                ? "TXT 입력 준비"
                : "MP3 입력 준비"
              : "마이크 권한",
            file ? "자료 구조 읽기" : "기본 문맥 준비",
            "실시간 강의 연결",
          ].map((label, index) => (
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
  materialIsPdf: boolean;
  slideMap: SlideMapDto;
  sessionState: SessionStateDto | null;
  pollingDelayed: boolean;
  pendingCount: number;
  elapsedSeconds: number;
  realtime: ReturnType<typeof useRealtimeTranscription>;
  testAudio: ReturnType<typeof useTestAudioInput>;
  testAudioFileName: string | null;
  testText: ReturnType<typeof useTestTextInput>;
  testTextFileName: string | null;
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
    materialIsPdf,
    slideMap,
    sessionState,
    pollingDelayed,
    pendingCount,
    elapsedSeconds,
    realtime,
    testAudio,
    testAudioFileName,
    testText,
    testTextFileName,
    warning,
    errorLog,
    demoEnabled,
    demoOpen,
    demoError,
    onToggleDemo,
    onDemoTranscript,
    onReturnToSetup,
  } = props;
  const [noteRequestBusy, setNoteRequestBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [endingCancelBusy, setEndingCancelBusy] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationFeedback, setTranslationFeedback] = useState<string | null>(null);
  const [translationOverride, setTranslationOverride] =
    useState<TranslationSettingsDto | null>(null);
  const [parallelFeedback, setParallelFeedback] = useState<string | null>(null);
  const [rejoinHighlightItemId, setRejoinHighlightItemId] = useState<string | null>(null);
  const [materialVisible, setMaterialVisible] = useState(true);
  const [assistantHeightVh, setAssistantHeightVh] = useState(46);
  const [resizingAssistant, setResizingAssistant] = useState(false);
  const [understandingOpening, setUnderstandingOpening] = useState<{
    selectedText: string | null;
    requestedAt: number;
    previousBranchCount: number;
  } | null>(null);
  const [selectionQuestionModal, setSelectionQuestionModal] = useState<{
    questionId: string | null;
    selection: TranscriptSelectionDto;
    anchor: { top: number; left: number };
    error: string | null;
  } | null>(null);
  const [quickDeferState, setQuickDeferState] = useState<
    "idle" | "saving" | "saved"
  >("idle");

  const currentPage =
    sessionState?.currentSlidePage ?? slideMap.slides[0]?.page ?? null;
  const currentSlide = slideMap.slides.find((slide) => slide.page === currentPage) ?? null;
  const transcripts = sessionState?.transcripts ?? [];
  const polledTranslationSettings = sessionState?.translationSettings ?? {
    enabled: false,
    targetLanguage: null,
    revision: 0,
    updatedAt: 0,
  };
  const translationSettings = translationOverride &&
      polledTranslationSettings.revision < translationOverride.revision
    ? translationOverride
    : polledTranslationSettings;
  const translations = sessionState?.translations ?? [];
  const slideResolution = sessionState?.slideResolution ?? null;
  const review = sessionState?.review ?? null;
  const questions = sessionState?.questions ?? [];
  const absenceSpans = sessionState?.absenceSpans ?? [];
  const missedFlowRequests = sessionState?.missedFlowRequests ?? [];
  const understandingBranches = sessionState?.understandingBranches ?? [];
  const deferredQuestions = sessionState?.deferredQuestions ?? [];
  const professorStyle = sessionState?.professorStyleProfile ?? null;
  const activityState = sessionState?.activityState ?? {
    currentActivity: "silence" as const,
    monitoringStartedAt: null,
    lastSpeechAt: null,
    lastMeaningfulInstructionAt: null,
    endingCandidate: null,
    inactivityCandidate: null,
  };
  const noteGeneration = sessionState?.noteGeneration ?? {
    enabled: true,
    intervalSeconds: 120,
    status: "idle" as const,
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
  const noteActive = noteGeneration.status === "queued" ||
    noteGeneration.status === "generating" ||
    noteGeneration.status === "reviewing";
  const processedNoteItemIds = new Set(noteGeneration.processedItemIds);
  const hasNewTranscript = transcripts.some(
    (turn) => !processedNoteItemIds.has(turn.itemId),
  );
  const sessionFinalizing = sessionState?.status === "finalizing";
  const sessionEnded = sessionState?.status === "ended";
  const activeUnderstandingBranch = understandingBranches.find(
    (branch) => branch.status === "active" || branch.status === "rejoining",
  ) ?? null;
  const visibleUnderstandingOpening = understandingOpening &&
      understandingBranches.length <= understandingOpening.previousBranchCount
    ? understandingOpening
    : null;

  useEffect(() => {
    if (!translationFeedback) return;
    const timer = window.setTimeout(() => setTranslationFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [translationFeedback]);

  useEffect(() => {
    if (!parallelFeedback) return;
    const timer = window.setTimeout(() => setParallelFeedback(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [parallelFeedback]);

  const handleTranslationChange = async (
    targetLanguage: TranslationTargetLanguageDto | null,
  ) => {
    if (translationBusy) return;
    setTranslationBusy(true);
    setTranslationFeedback(null);
    try {
      const response = await setTranslationSettings(sessionId, {
        enabled: targetLanguage !== null,
        targetLanguage,
      });
      setTranslationOverride(response.translationSettings);
      setTranslationFeedback(
        targetLanguage === "en"
          ? "다음 발화부터 영어로 번역합니다."
          : targetLanguage === "ko"
            ? "다음 발화부터 한국어로 번역합니다."
            : "실시간 번역을 껐습니다.",
      );
    } catch {
      setTranslationFeedback(
        "번역 설정을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setTranslationBusy(false);
    }
  };

  const handleGenerateNote = async () => {
    setNoteRequestBusy(true);
    setNoteMessage(null);
    try {
      const result = await generateLectureNote(sessionId);
      setNoteMessage(result.message);
    } catch (error) {
      setNoteMessage(error instanceof ApiError ? error.message : "필기 요청에 실패했습니다.");
    } finally {
      setNoteRequestBusy(false);
    }
  };

  const handleToggleAutomaticNotes = async (enabled: boolean) => {
    setNoteRequestBusy(true);
    setNoteMessage(null);
    try {
      const result = await setAutomaticLectureNotes(sessionId, enabled);
      setNoteMessage(result.message);
    } catch (error) {
      setNoteMessage(error instanceof ApiError ? error.message : "자동 필기 설정을 바꾸지 못했습니다.");
    } finally {
      setNoteRequestBusy(false);
    }
  };

  const handleQuestion = async (question: string) => {
    await askLectureQuestion(sessionId, question);
  };

  const handleAskSelection = async (
    selection: TranscriptSelectionDto,
    anchor: { top: number; left: number },
  ) => {
    setSelectionQuestionModal({ questionId: null, selection, anchor, error: null });
    try {
      const result = await askTranscriptSelection(sessionId, selection);
      setSelectionQuestionModal((current) => current
        ? { ...current, questionId: result.questionId, error: null }
        : current);
    } catch (error) {
      setSelectionQuestionModal((current) => current
        ? {
            ...current,
            error: error instanceof ApiError
              ? error.message
              : "답변 요청을 보내지 못했습니다.",
          }
        : current);
      throw error;
    }
  };

  const handleStartUnderstanding = async (selection?: TranscriptSelectionDto) => {
    setUnderstandingOpening({
      selectedText: selection?.selectedText ?? transcripts.at(-1)?.text ?? null,
      requestedAt: Date.now(),
      previousBranchCount: understandingBranches.length,
    });
    setParallelFeedback(null);
    try {
      const result = await startUnderstandingBranch(sessionId, selection);
      if (!result.accepted) setUnderstandingOpening(null);
      setParallelFeedback(result.message);
    } catch (error) {
      setUnderstandingOpening(null);
      setParallelFeedback(error instanceof ApiError ? error.message : "이해 분기를 시작하지 못했습니다.");
      throw error;
    }
  };

  const handleAssistantResizeStart = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (window.matchMedia("(max-width: 1099px)").matches) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeightVh = assistantHeightVh;
    setResizingAssistant(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaVh = (moveEvent.clientY - startY) / window.innerHeight * 100;
      setAssistantHeightVh(clampAssistantHeight(startHeightVh - deltaVh));
    };
    const stopResize = () => {
      setResizingAssistant(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const handleAssistantResizeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setAssistantHeightVh((height) => clampAssistantHeight(
        height + (event.key === "ArrowUp" ? 4 : -4),
      ));
    }
    if (event.key === "Home") {
      event.preventDefault();
      setAssistantHeightVh(46);
    }
  };

  const handleDeferQuestion = async () => {
    try {
      const result = await createDeferredQuestion(sessionId, {});
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "질문을 맡기지 못했습니다.");
      throw error;
    }
  };

  const handleDeferCurrentTranscript = async () => {
    if (quickDeferState === "saving") return;
    setQuickDeferState("saving");
    try {
      await handleDeferQuestion();
      setQuickDeferState("saved");
      window.setTimeout(() => setQuickDeferState("idle"), 3_000);
    } catch {
      setQuickDeferState("idle");
    }
  };

  const handleBranchMessage = async (branchId: string, message: string) => {
    try {
      const result = await sendUnderstandingBranchMessage(sessionId, branchId, message);
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "추가 질문을 보내지 못했습니다.");
    }
  };

  const handleRejoin = async (branchId: string) => {
    try {
      const result = await rejoinUnderstandingBranch(sessionId, branchId);
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "현재 수업으로 합류하지 못했습니다.");
    }
  };

  const handleResumeLecture = (branch: UnderstandingBranchDto) => {
    const latest = transcripts.at(-1);
    setMaterialVisible(false);
    setRejoinHighlightItemId(latest?.itemId ?? null);
    setParallelFeedback(
      `현재 수업으로 합류했습니다. 현재 주제: ${branch.rejoinPacket?.quickRejoin.currentTopic ?? "최신 수업 위치"}`,
    );
    window.setTimeout(() => setRejoinHighlightItemId(null), 3_000);
  };

  const handleCheckDeferred = async (questionId: string) => {
    try {
      const result = await checkDeferredQuestion(sessionId, questionId);
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "설명 여부를 확인하지 못했습니다.");
    }
  };

  const handleUpdateDeferred = async (
    questionId: string,
    action: "resolve" | "keep_waiting" | "still_confused",
  ) => {
    try {
      const result = await updateDeferredQuestion(sessionId, questionId, action);
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "질문 상태를 바꾸지 못했습니다.");
    }
  };

  const handleExplainDeferred = async (questionId: string) => {
    try {
      const result = await explainDeferredQuestion(sessionId, questionId);
      setParallelFeedback(result.message);
    } catch (error) {
      setParallelFeedback(error instanceof ApiError ? error.message : "AI 보충 설명을 열지 못했습니다.");
    }
  };

  const handleStartAbsence = async () => {
    await startLectureAbsence(sessionId);
  };

  const handleEndAbsence = async () => {
    await endLectureAbsence(sessionId);
  };

  const handleMissedFlow = async () => {
    await requestMissedFlowRecovery(sessionId);
  };

  const handleCancelEnding = async () => {
    setEndingCancelBusy(true);
    try {
      await cancelAutomaticEnding(sessionId);
    } finally {
      setEndingCancelBusy(false);
    }
  };

  const micStatus = testTextFileName
    ? testText.phase === "playing"
      ? "TXT LIVE"
      : testText.phase.toUpperCase()
    : testAudioFileName
    ? testAudio.phase === "paused"
      ? "PAUSED"
      : testAudio.phase === "ended"
        ? "FILE END"
        : testAudio.phase === "playing"
          ? "MP3 LIVE"
          : testAudio.phase.toUpperCase()
    : realtime.connectionPhase === "error"
      ? "ERROR"
      : realtime.speaking
        ? "SPEECH"
        : realtime.connectionPhase === "connecting"
          ? "CONNECTING"
          : realtime.connectionPhase === "idle"
            ? "OFF"
            : "LIVE";
  const transcriptStatus = testTextFileName
    ? testText.phase === "playing"
      ? "STREAMING"
      : testText.phase.toUpperCase()
    : realtime.speaking
      ? "DETECTING"
      : realtime.connectionPhase === "listening"
        ? "READY"
        : realtime.connectionPhase.toUpperCase();
  const visiblePartials = testTextFileName && testText.partialTranscript
    ? new Map([["txt-demo-partial", testText.partialTranscript]])
    : realtime.partialTranscripts;
  const agentStatus = phase === "ended"
    ? "ENDED"
    : sessionFinalizing
      ? "FINALIZING"
    : activityState.endingCandidate
      ? "ENDING?"
    : phase === "connecting-realtime"
      ? "CONNECTING"
    : pendingCount > 0
      ? "QUEUED"
      : "CAPTURING";
  const toolStatus = noteActive ? "COMPOSING" : "READY";

  const statusSentence = warning ?? (pollingDelayed
    ? "수업 상태 동기화가 잠시 지연되고 있습니다."
    : sessionFinalizing
      ? "남은 대본을 포함해 최종 필기와 복습지를 정리하고 있습니다."
    : activityState.endingCandidate
      ? activityState.endingCandidate.kind === "explicit"
        ? "실제 종료 맥락을 감지했습니다. 계속 듣기를 누르거나 새 설명이 시작되면 취소됩니다."
        : "10분 동안 수업다운 내용이 없어 종료 전 확인 중입니다."
    : phase === "ended"
      ? "수업이 끝났습니다. 복습 노트를 정리했습니다."
      : phase === "connecting-realtime"
        ? testTextFileName
          ? "TXT 원고를 문장 단위 입력으로 준비하고 있습니다."
          : testAudioFileName
            ? "MP3 테스트 입력과 강의실을 연결하고 있습니다."
          : "마이크와 강의실을 연결하고 있습니다."
      : noteActive
        ? "기존 필기와 새 대본을 하나의 필기로 통합하고 있습니다."
        : pendingCount > 0
          ? "방금 자막을 저장하고 해석 순서에 추가했습니다."
          : testTextFileName && testText.phase === "playing"
            ? `TXT 원고를 문장별로 입력하고 있습니다. (${testText.completedSentences}/${testText.sentenceCount})`
            : testTextFileName && testText.phase === "ended"
              ? `TXT 원고 ${testText.sentenceCount}문장 입력을 마쳤습니다.`
          : realtime.connectionPhase === "error"
            ? "실시간 연결은 멈췄지만 수업 세션은 유지되고 있습니다."
            : "수업 대본을 저장하고 다음 필기 체크포인트를 기다리고 있습니다.");

  return (
    <main
      className={`${styles.workspace} ${phase === "ended" ? styles.workspaceEnded : ""} ${resizingAssistant ? styles.workspaceResizing : ""}`}
      style={{
        "--assistant-height": `calc(${assistantHeightVh}svh - ${assistantHeightVh * 0.69}px)`,
      } as CSSProperties}
    >
      <SignalRail
        title={slideMap.documentTitle || fileName}
        elapsed={elapsedSeconds}
        mic={micStatus}
        transcript={transcriptStatus}
        agent={agentStatus}
        tool={toolStatus}
        translationSettings={translationSettings}
        translationBusy={translationBusy}
        translationFeedback={translationFeedback}
        translationDisabled={sessionFinalizing || sessionEnded}
        onTranslationChange={(targetLanguage) =>
          void handleTranslationChange(targetLanguage)}
        statusSentence={statusSentence}
        sessionId={sessionId}
        onReturnToSetup={onReturnToSetup}
      />

      <div className={styles.lectureGrid}>
        <PageRail slides={slideMap.slides} currentPage={currentPage} />
        <section className={styles.primaryStage} aria-label="강의 자료와 실시간 대본">
          <header className={styles.primaryStageToolbar}>
            <div>
              <strong>{materialVisible ? "PRESENTATION" : "LIVE TRANSCRIPT"}</strong>
              <span>{materialVisible ? "강의 자료를 보고 있습니다" : "PPT를 가리고 대본을 보고 있습니다"}</span>
            </div>
            <button
              type="button"
              aria-pressed={!materialVisible}
              onClick={() => setMaterialVisible((visible) => !visible)}
            >
              {materialVisible ? "PPT 숨기기 · 대본 보기" : "PPT 다시 보기"}
            </button>
          </header>
          <div className={styles.primaryStageBody}>
            {materialVisible ? (
              materialUrl && materialIsPdf ? (
                <div className={styles.slideStage}>
                  <LivePdfViewer
                    key={materialUrl}
                    pdfUrl={materialUrl}
                    currentPage={currentPage}
                    totalPages={slideMap.slides.length}
                    transitionReason={slideResolution?.reason}
                  />
                </div>
              ) : (
                <SlideContextSheet
                  slideMap={slideMap}
                  slide={currentSlide}
                  currentPage={currentPage}
                  materialUrl={materialUrl}
                  noMaterialMode={!materialUrl}
                />
              )
            ) : (
              <div className={styles.promotedTranscript}>
                <TranscriptNotebook
                  transcripts={transcripts}
                  partials={visiblePartials}
                  translationSettings={translationSettings}
                  translations={translations}
                  embedded
                  showUnderstandingButton={false}
                  highlightItemId={rejoinHighlightItemId}
                  onStartUnderstanding={sessionFinalizing || sessionEnded
                    ? undefined
                    : handleStartUnderstanding}
                  onAskSelection={sessionFinalizing || sessionEnded
                    ? undefined
                    : handleAskSelection}
                />
              </div>
            )}
          </div>
        </section>
        <div className={styles.marginStack}>
          <StructuredNotesPanel
            noteGeneration={noteGeneration}
            sessionEnded={phase === "ended" || sessionFinalizing}
            hasNewTranscript={hasNewTranscript}
            message={noteMessage}
            requestBusy={noteRequestBusy}
            onGenerate={() => void handleGenerateNote()}
            onToggle={(enabled) => void handleToggleAutomaticNotes(enabled)}
          />
        </div>
      </div>

      <button
        className={styles.workspaceDivider}
        type="button"
        role="separator"
        aria-label="상호작용 영역 높이 조절"
        aria-orientation="horizontal"
        aria-valuemin={25}
        aria-valuemax={100}
        aria-valuenow={Math.round(assistantHeightVh)}
        aria-valuetext={`화면 높이의 약 ${Math.round(assistantHeightVh)}퍼센트`}
        onPointerDown={handleAssistantResizeStart}
        onKeyDown={handleAssistantResizeKey}
        onDoubleClick={() => setAssistantHeightVh(46)}
      />

      <div className={`${styles.assistantBand} ${!materialVisible ? styles.assistantBandTranscriptRaised : ""}`}>
        {materialVisible && (
          <TranscriptNotebook
            transcripts={transcripts}
            partials={visiblePartials}
            translationSettings={translationSettings}
            translations={translations}
            embedded
            showUnderstandingButton={false}
            highlightItemId={rejoinHighlightItemId}
            onStartUnderstanding={sessionFinalizing || sessionEnded
              ? undefined
              : handleStartUnderstanding}
            onAskSelection={sessionFinalizing || sessionEnded
              ? undefined
              : handleAskSelection}
          />
        )}
        <div className={styles.supportPanel}>
          <div className={styles.quickInteractionBar}>
            <div>
              <span>QUICK INTERACTION</span>
              <small>수업을 멈추지 않고 바로 도움받기</small>
            </div>
            <button
              type="button"
              disabled={
                transcripts.length === 0 ||
                sessionFinalizing ||
                sessionEnded ||
                Boolean(visibleUnderstandingOpening) ||
                Boolean(activeUnderstandingBranch)
              }
              onClick={() => void handleStartUnderstanding().catch(() => undefined)}
            >
              <span aria-hidden="true">?</span>
              <div>
                <strong>
                  {visibleUnderstandingOpening
                    ? "AI가 분석하고 있어요…"
                    : activeUnderstandingBranch
                      ? "개인 보충 설명 진행 중"
                      : "방금 내용이 이해되지 않아요"}
                </strong>
                <small>방금 대본을 더 쉽게 풀어서 설명받기</small>
              </div>
              <i aria-hidden="true">→</i>
            </button>
            <button
              className={styles.quickDeferButton}
              type="button"
              disabled={
                transcripts.length === 0 ||
                sessionFinalizing ||
                sessionEnded ||
                quickDeferState !== "idle"
              }
              onClick={() => void handleDeferCurrentTranscript()}
            >
              <span aria-hidden="true">⌛</span>
              <div>
                <strong>
                  {quickDeferState === "saving"
                    ? "현재 대본을 맡기고 있어요…"
                    : quickDeferState === "saved"
                      ? "수업 종료 후 답변할게요"
                      : "질문 맡겨두기"}
                </strong>
                <small>현재 실시간 대본을 저장하고 수업 종료 후 답변받기</small>
              </div>
              <i aria-hidden="true">→</i>
            </button>
          </div>
          <div className={styles.parallelLectureSlot}>
            <ParallelLecturePanel
              branches={understandingBranches}
              deferredQuestions={deferredQuestions}
              transcripts={transcripts}
              disabled={sessionFinalizing || sessionEnded}
              sessionEnded={sessionEnded}
              feedback={parallelFeedback}
              openingInteraction={visibleUnderstandingOpening}
              onMessage={handleBranchMessage}
              onRejoin={handleRejoin}
              onResumeLecture={handleResumeLecture}
              onCheckDeferred={handleCheckDeferred}
              onUpdateDeferred={handleUpdateDeferred}
              onExplainDeferred={handleExplainDeferred}
            />
          </div>
          <MissedFlowControl
            requests={missedFlowRequests}
            disabled={sessionFinalizing || sessionEnded}
            onRequest={handleMissedFlow}
          />
          <AbsenceToggle
            spans={absenceSpans}
            disabled={sessionFinalizing || sessionEnded}
            onStart={handleStartAbsence}
            onEnd={handleEndAbsence}
          />
          <LectureQuestionDock
            questions={questions}
            professorStyle={professorStyle}
            disabled={sessionFinalizing || sessionEnded}
            onQuestion={handleQuestion}
            openRequestId={null}
          />
        </div>
      </div>

      <EndingCandidateBanner
        activity={activityState}
        busy={endingCancelBusy}
        onCancel={handleCancelEnding}
      />

      <div className={styles.liveSentence} aria-live="polite">
        <span className={pollingDelayed ? styles.delayDot : styles.statusDot} />
        {statusSentence}
      </div>

      {errorLog && <ErrorLogDetails log={errorLog} compact />}

      {review && phase === "ended" && <ReviewSheet review={review} />}

      {selectionQuestionModal && (
        <SelectionExplanationModal
          question={questions.find(
            (question) => question.id === selectionQuestionModal.questionId,
          ) ?? null}
          selectedText={selectionQuestionModal.selection.selectedText}
          anchor={selectionQuestionModal.anchor}
          error={selectionQuestionModal.error}
          onRetry={() => void handleAskSelection(
            selectionQuestionModal.selection,
            selectionQuestionModal.anchor,
          ).catch(() => undefined)}
          onClose={() => setSelectionQuestionModal(null)}
        />
      )}

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
  translationSettings,
  translationBusy,
  translationFeedback,
  translationDisabled,
  onTranslationChange,
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
  translationSettings: TranslationSettingsDto;
  translationBusy: boolean;
  translationFeedback: string | null;
  translationDisabled: boolean;
  onTranslationChange: (language: TranslationTargetLanguageDto | null) => void;
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
      <TranslationControl
        settings={translationSettings}
        busy={translationBusy}
        feedback={translationFeedback}
        disabled={translationDisabled}
        onChange={onTranslationChange}
      />
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
                  빈 Material Knowledge로 시작해 누적 수업 대본만으로 강의
                  단원과 구조화 필기를 해석합니다.
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

// Deprecated compatibility renderer: intentionally disconnected from LiveWorkspace.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      <NoteMeta
        label={`EMPHASIS · ${event.emphasisKind.replaceAll("_", " ").toUpperCase()}`}
        page={event.slidePage}
        time={event.createdAt}
      />
      <blockquote>{event.quote}</blockquote>
      <small className={styles.resolvedLabel}>정리된 중요 내용</small>
      <p className={styles.noteConcept}>{event.resolvedConcept}</p>
      <small>{event.reason}</small>
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
          <p>OpenAI 웹 검색으로 외부 근거를 확인하고 있습니다.</p>
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
                <small>{source.hostname ?? "외부 출처"} ↗</small>
              </a>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function NoteMeta({ label, page, time }: { label: string; page: number | null; time: string }) {
  return (
    <header className={styles.noteMeta}>
      <strong>{label}</strong>
      <span>PAGE {page ?? "—"} · {formatClock(time)}</span>
    </header>
  );
}

// Deprecated recent-only ribbon: TranscriptNotebook is the active transcript UI.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TranscriptRibbon({
  meterLevels,
  speaking,
  partials,
  localFinals,
  serverFinals,
  emphasisEvents,
  warning,
  testAudio,
}: {
  meterLevels: number[];
  speaking: boolean;
  partials: ReadonlyMap<string, string>;
  localFinals: string[];
  serverFinals: TranscriptDto[];
  emphasisEvents: EmphasisEventDto[];
  warning: string | null;
  testAudio: {
    fileName: string;
    phase: ReturnType<typeof useTestAudioInput>["phase"];
    currentTime: number;
    duration: number;
    error: string | null;
    onTogglePause: () => void;
  } | null;
}) {
  const activePartial = Array.from(partials.entries()).at(-1)?.[1] ?? "";
  const finals = serverFinals.length > 0
    ? serverFinals
    : localFinals.map((text, index) => ({
        id: `local-${index}`,
        itemId: `local-${index}`,
        sequence: -1,
        text,
        source: "realtime" as const,
        receivedAt: "",
        startedAtMs: null,
        endedAtMs: null,
        matchedSlidePages: [],
      }));
  const currentFinal = finals.at(-1) ?? null;
  return (
    <section className={styles.transcriptRibbon} aria-label="실시간 자막">
      <div className={`${styles.audioMeter} ${speaking ? styles.audioMeterSpeaking : ""} ${testAudio ? styles.audioMeterTest : ""}`}>
        {testAudio ? (
          <div className={styles.testAudioTransport}>
            <span>MP3 · {testAudio.phase.toUpperCase()}</span>
            <strong title={testAudio.fileName}>{testAudio.fileName}</strong>
            <div>
              <time>{formatAudioTime(testAudio.currentTime)} / {formatAudioTime(testAudio.duration)}</time>
              <button
                type="button"
                onClick={testAudio.onTogglePause}
                disabled={testAudio.phase === "ended" || testAudio.phase === "error"}
              >
                {testAudio.phase === "paused" ? "재생" : "일시정지"}
              </button>
            </div>
            {testAudio.error && <small>{testAudio.error}</small>}
          </div>
        ) : (
          <span className={styles.liveLabel}>{speaking ? "SPEECH" : "LIVE"}</span>
        )}
        <div className={styles.meterBars} aria-label={testAudio ? "MP3 입력 음량" : "마이크 음량"}>
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
          {finals.slice(-3, -1).map((transcript) => (
            <p key={transcript.itemId}>
              <HighlightedTranscript
                transcript={transcript}
                emphasisEvents={emphasisEvents}
              />
            </p>
          ))}
        </div>
        <p className={styles.currentTranscript}>
          {activePartial ? activePartial : currentFinal ? (
            <HighlightedTranscript
              transcript={currentFinal}
              emphasisEvents={emphasisEvents}
            />
          ) : "말을 시작하면 이곳에 강의 자막이 흐릅니다."}
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

function HighlightedTranscript({
  transcript,
  emphasisEvents,
}: {
  transcript: TranscriptDto;
  emphasisEvents: EmphasisEventDto[];
}) {
  const event = [...emphasisEvents].reverse().find(
    (candidate) =>
      candidate.quote.length > 0 &&
      transcript.text.includes(candidate.quote) &&
      (candidate.sourceSequences.length === 0 ||
        candidate.sourceSequences.includes(transcript.sequence)),
  );
  if (!event) return transcript.text;
  const start = transcript.text.indexOf(event.quote);
  if (start < 0) return transcript.text;
  const end = start + event.quote.length;
  return (
    <>
      {transcript.text.slice(0, start)}
      <mark className={styles.transcriptEmphasis}>{transcript.text.slice(start, end)}</mark>
      {transcript.text.slice(end)}
    </>
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

function clampAssistantHeight(heightVh: number): number {
  return Math.min(100, Math.max(25, heightVh));
}

function formatAudioTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  return formatElapsed(Math.floor(totalSeconds));
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
