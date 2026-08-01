"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRealtimeToken } from "./api";
import { captureClientError, type ClientErrorLog } from "./error-log";

export interface RealtimeFinalTranscript {
  itemId: string;
  sequence: number;
  text: string;
  receivedAt: string;
}

type ConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "error";

interface RealtimeOptions {
  onFinalTranscript: (
    transcript: RealtimeFinalTranscript,
  ) => Promise<void> | void;
}

// Realtime transcription stays browser-to-OpenAI over WebRTC; no app WebSocket exists.
export function useRealtimeTranscription({
  onFinalTranscript,
}: RealtimeOptions) {
  const [connectionPhase, setConnectionPhase] =
    useState<ConnectionPhase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [partialTranscripts, setPartialTranscripts] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [recentFinals, setRecentFinals] = useState<RealtimeFinalTranscript[]>([]);
  const [meterLevels, setMeterLevels] = useState<number[]>(
    () => Array.from({ length: 22 }, () => 0),
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ClientErrorLog | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const partialRef = useRef<Map<string, string>>(new Map());
  const sequenceByItemRef = useRef<Map<string, number>>(new Map());
  const completedItemIdsRef = useRef<Set<string>>(new Set());
  const sequenceRef = useRef(0);
  const callbackRef = useRef(onFinalTranscript);

  useEffect(() => {
    callbackRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const updatePartials = useCallback((next: Map<string, string>) => {
    partialRef.current = next;
    setPartialTranscripts(new Map(next));
  }, []);

  const ensureSequence = useCallback((itemId: string): number => {
    const existing = sequenceByItemRef.current.get(itemId);
    if (existing !== undefined) return existing;
    sequenceRef.current += 1;
    sequenceByItemRef.current.set(itemId, sequenceRef.current);
    return sequenceRef.current;
  }, []);

  const stopResources = useCallback((updateUi = true) => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    partialRef.current = new Map();
    sequenceByItemRef.current = new Map();
    completedItemIdsRef.current = new Set();
    if (updateUi) {
      setConnectionPhase("idle");
      setSpeaking(false);
      setPartialTranscripts(new Map());
      setMeterLevels(Array.from({ length: 22 }, () => 0));
    }
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.72;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let lastPaint = 0;

    const paint = (time: number) => {
      analyser.getByteFrequencyData(bins);
      if (time - lastPaint > 32) {
        lastPaint = time;
        setMeterLevels(
          Array.from({ length: 22 }, (_, index) => {
            const binIndex = Math.min(
              bins.length - 1,
              Math.floor((index / 21) * bins.length),
            );
            return Math.max(0.04, bins[binIndex] / 255);
          }),
        );
      }
      animationFrameRef.current = requestAnimationFrame(paint);
    };
    animationFrameRef.current = requestAnimationFrame(paint);
  }, []);

  const handleRealtimeEvent = useCallback(
    (payload: unknown) => {
      if (!payload || typeof payload !== "object" || !("type" in payload)) return;
      const event = payload as Record<string, unknown>;
      const type = typeof event.type === "string" ? event.type : "";
      const itemId = typeof event.item_id === "string" ? event.item_id : null;

      if (type === "conversation.item.input_audio_transcription.delta") {
        if (!itemId || typeof event.delta !== "string") return;
        const next = new Map(partialRef.current);
        next.set(itemId, `${next.get(itemId) ?? ""}${event.delta}`);
        updatePartials(next);
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        if (!itemId || completedItemIdsRef.current.has(itemId)) return;
        const text =
          typeof event.transcript === "string"
            ? event.transcript.trim()
            : (partialRef.current.get(itemId) ?? "").trim();
        completedItemIdsRef.current.add(itemId);
        const next = new Map(partialRef.current);
        next.delete(itemId);
        updatePartials(next);
        if (!text) return;

        const completed: RealtimeFinalTranscript = {
          itemId,
          sequence: ensureSequence(itemId),
          text,
          receivedAt: new Date().toISOString(),
        };
        setRecentFinals((current) => [...current, completed].slice(-3));
        Promise.resolve(callbackRef.current(completed)).catch(() => {
          setWarning("완성된 자막을 강의 문맥과 대조하지 못했습니다. 다음 발화는 계속 듣습니다.");
        });
        return;
      }

      if (type === "conversation.item.input_audio_transcription.failed") {
        if (itemId) {
          const next = new Map(partialRef.current);
          next.delete(itemId);
          updatePartials(next);
        }
        setWarning(
          "방금 발화를 정확히 옮기지 못했습니다. 다음 발화부터 계속 듣습니다.",
        );
        return;
      }

      if (type === "input_audio_buffer.speech_started") {
        if (itemId) ensureSequence(itemId);
        setSpeaking(true);
        setWarning(null);
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        setSpeaking(false);
        return;
      }

      if (type === "input_audio_buffer.committed") {
        if (itemId) ensureSequence(itemId);
        return;
      }

      if (type === "session.created" || type === "session.updated") {
        setConnectionPhase("listening");
        return;
      }

      if (type === "error") {
        const nested =
          event.error && typeof event.error === "object"
            ? (event.error as Record<string, unknown>)
            : null;
        const message = nested && typeof nested.message === "string"
          ? nested.message
          : "실시간 음성 연결에서 오류가 발생했습니다.";
        setErrorLog(
          captureClientError("realtime.server_event", new Error(message)),
        );
        setError(message);
        setConnectionPhase("error");
      }
    },
    [ensureSequence, updatePartials],
  );

  const connect = useCallback(
    async (sessionId: string, stream: MediaStream) => {
      stopResources();
      setError(null);
      setErrorLog(null);
      setWarning(null);
      setRecentFinals([]);
      setConnectionPhase("connecting");
      streamRef.current = stream;

      try {
        startMeter(stream);
        const token = await createRealtimeToken(sessionId);
        const peer = new RTCPeerConnection();
        const channel = peer.createDataChannel("oai-events");
        peerRef.current = peer;
        channelRef.current = channel;
        stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

        channel.addEventListener("message", (message) => {
          if (typeof message.data !== "string") return;
          try {
            handleRealtimeEvent(JSON.parse(message.data) as unknown);
          } catch {
            setWarning("실시간 신호 하나를 읽지 못했지만 연결은 계속 유지됩니다.");
          }
        });

        peer.addEventListener("connectionstatechange", () => {
          if (peer.connectionState === "connected") {
            setConnectionPhase("connected");
          } else if (peer.connectionState === "failed") {
            stopResources();
            setErrorLog(
              captureClientError(
                "realtime.peer_connection",
                new Error(`WebRTC connection state: ${peer.connectionState}`),
              ),
            );
            setConnectionPhase("error");
            setError(
              "실시간 음성 연결에 실패했습니다. 수업 세션은 유지되고 있습니다.",
            );
          }
        });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (!offer.sdp) throw new Error("브라우저가 오디오 연결 정보를 만들지 못했습니다.");

        const sdpResponse = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.value}`,
              "Content-Type": "application/sdp",
            },
            body: offer.sdp,
          },
        );
        if (!sdpResponse.ok) {
          throw new Error(`실시간 연결 요청이 거절되었습니다. (${sdpResponse.status})`);
        }
        await peer.setRemoteDescription({
          type: "answer",
          sdp: await sdpResponse.text(),
        });

        await new Promise<void>((resolve, reject) => {
          if (channel.readyState === "open") {
            resolve();
            return;
          }
          const timeout = window.setTimeout(
            () => reject(new Error("실시간 채널 연결 시간이 초과되었습니다.")),
            10_000,
          );
          channel.addEventListener(
            "open",
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
        setConnectionPhase("listening");
      } catch (connectError) {
        const message = connectError instanceof Error
          ? connectError.message
          : "실시간 음성 연결에 실패했습니다.";
        stopResources();
        setConnectionPhase("error");
        setError(`${message} 수업 세션은 유지되고 있습니다.`);
        throw connectError;
      }
    },
    [handleRealtimeEvent, startMeter, stopResources],
  );

  const disconnect = useCallback(() => {
    stopResources();
  }, [stopResources]);

  useEffect(() => () => stopResources(false), [stopResources]);

  return {
    connect,
    disconnect,
    connectionPhase,
    speaking,
    partialTranscripts,
    recentFinals,
    meterLevels,
    error,
    errorLog,
    warning,
  };
}
