"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TestAudioPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

interface TestAudioResources {
  context: AudioContext;
  source: AudioBufferSourceNode;
  destination: MediaStreamAudioDestinationNode;
  started: boolean;
  startedAt: number;
}

// Decodes a developer-supplied MP3 and exposes it as a real-time MediaStream.
// The same source is also connected to the speakers so the developer can
// monitor exactly what is being sent to OpenAI Realtime.
export function useTestAudioInput() {
  const [phase, setPhase] = useState<TestAudioPhase>("idle");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const resourcesRef = useRef<TestAudioResources | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const releaseResources = useCallback(
    (updateUi: boolean) => {
      generationRef.current += 1;
      clearProgressTimer();
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      if (resources) {
        resources.source.onended = null;
        if (resources.started) {
          try {
            resources.source.stop();
          } catch {
            // The source may already have reached its natural end.
          }
        }
        resources.destination.stream.getTracks().forEach((track) => track.stop());
        void resources.context.close().catch(() => undefined);
      }
      if (updateUi) {
        setPhase("idle");
        setDuration(0);
        setCurrentTime(0);
        setError(null);
      }
    },
    [clearProgressTimer],
  );

  const updateProgress = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources?.started) return;
    setCurrentTime((current) => {
      const next = Math.min(
        resources.source.buffer?.duration ?? current,
        Math.max(0, resources.context.currentTime - resources.startedAt),
      );
      return Math.abs(next - current) >= 0.1 ? next : current;
    });
  }, []);

  const startProgressTimer = useCallback(() => {
    clearProgressTimer();
    progressTimerRef.current = setInterval(updateProgress, 200);
  }, [clearProgressTimer, updateProgress]);

  const prepare = useCallback(
    async (file: File): Promise<MediaStream> => {
      releaseResources(true);
      const generation = generationRef.current;
      setPhase("preparing");
      setError(null);

      const context = new AudioContext();
      // Creating/resuming the context inside the click handler preserves the
      // browser's user-activation grant while the file and session are prepared.

      try {
        if (context.state === "suspended") await context.resume();
        const fileBytes = await file.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(fileBytes.slice(0));
        if (generation !== generationRef.current) {
          await context.close();
          throw new Error("MP3 테스트 입력 준비가 취소되었습니다.");
        }
        if (audioBuffer.duration <= 0) {
          throw new Error("재생할 수 있는 오디오가 없는 MP3 파일입니다.");
        }

        const source = context.createBufferSource();
        const destination = context.createMediaStreamDestination();
        const monitorGain = context.createGain();
        const outputTrack = destination.stream.getAudioTracks()[0];
        if (outputTrack) outputTrack.contentHint = "speech";
        source.buffer = audioBuffer;
        source.connect(destination);
        source.connect(monitorGain);
        monitorGain.connect(context.destination);

        const resources: TestAudioResources = {
          context,
          source,
          destination,
          started: false,
          startedAt: 0,
        };
        resourcesRef.current = resources;
        source.onended = () => {
          if (resourcesRef.current !== resources) return;
          clearProgressTimer();
          setCurrentTime(audioBuffer.duration);
          setPhase("ended");
        };

        setDuration(audioBuffer.duration);
        setCurrentTime(0);
        setPhase("ready");
        return destination.stream;
      } catch (prepareError) {
        if (resourcesRef.current?.context !== context) {
          void context.close().catch(() => undefined);
        }
        const message = prepareError instanceof Error
          ? prepareError.message
          : "MP3 파일을 오디오 스트림으로 변환하지 못했습니다.";
        if (generation === generationRef.current) {
          setPhase("error");
          setError(message);
        }
        throw prepareError;
      }
    },
    [clearProgressTimer, releaseResources],
  );

  const play = useCallback(async () => {
    const resources = resourcesRef.current;
    if (!resources) throw new Error("준비된 MP3 테스트 입력이 없습니다.");
    if (resources.context.state === "suspended") await resources.context.resume();

    if (!resources.started) {
      resources.started = true;
      resources.startedAt = resources.context.currentTime;
      resources.source.start(0);
    }
    setPhase("playing");
    startProgressTimer();
  }, [startProgressTimer]);

  const togglePause = useCallback(async () => {
    const resources = resourcesRef.current;
    if (!resources?.started) return;
    try {
      if (resources.context.state === "running") {
        await resources.context.suspend();
        updateProgress();
        clearProgressTimer();
        setPhase("paused");
        return;
      }
      await resources.context.resume();
      setPhase("playing");
      startProgressTimer();
    } catch (toggleError) {
      clearProgressTimer();
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "MP3 재생 상태를 변경하지 못했습니다.",
      );
      setPhase("error");
    }
  }, [clearProgressTimer, startProgressTimer, updateProgress]);

  const stop = useCallback(() => {
    releaseResources(true);
  }, [releaseResources]);

  useEffect(() => () => releaseResources(false), [releaseResources]);

  return {
    prepare,
    play,
    togglePause,
    stop,
    phase,
    duration,
    currentTime,
    error,
  };
}
