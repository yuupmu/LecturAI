"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TestTextPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

interface TestTextResources {
  sentences: string[];
  sentenceIndex: number;
  visibleCharacters: number;
  paused: boolean;
  submitting: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface TestTextInputOptions {
  onSentence: (sentence: string) => Promise<boolean> | boolean;
}

const CHARACTER_INTERVAL_MS = 55;
const CHARACTERS_PER_TICK = 2;
const SENTENCE_GAP_MS = 650;

// Keeps sentence-ending punctuation while treating a line break as a boundary
// for scripts that are formatted as one spoken sentence per line.
export function splitTextIntoSentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Simulates Realtime's partial -> completed transcript flow without creating
// an audio or WebRTC connection. Only completed sentences reach the API.
export function useTestTextInput({ onSentence }: TestTextInputOptions) {
  const [phase, setPhase] = useState<TestTextPhase>("idle");
  const [sentenceCount, setSentenceCount] = useState(0);
  const [completedSentences, setCompletedSentences] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resourcesRef = useRef<TestTextResources | null>(null);
  const onSentenceRef = useRef(onSentence);
  const stepRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onSentenceRef.current = onSentence;
  }, [onSentence]);

  const clearTimer = useCallback((resources: TestTextResources) => {
    if (resources.timer) {
      clearTimeout(resources.timer);
      resources.timer = null;
    }
  }, []);

  const releaseResources = useCallback(
    (updateUi: boolean) => {
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      if (resources) clearTimer(resources);
      if (updateUi) {
        setPhase("idle");
        setSentenceCount(0);
        setCompletedSentences(0);
        setPartialTranscript("");
        setError(null);
      }
    },
    [clearTimer],
  );

  const queueStep = useCallback((delay: number) => {
    const resources = resourcesRef.current;
    if (!resources || resources.paused) return;
    clearTimer(resources);
    resources.timer = setTimeout(() => stepRef.current(), delay);
  }, [clearTimer]);

  const step = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources || resources.paused || resources.submitting) return;

    const sentence = resources.sentences[resources.sentenceIndex];
    if (!sentence) {
      setPartialTranscript("");
      setPhase("ended");
      return;
    }

    if (resources.visibleCharacters < sentence.length) {
      resources.visibleCharacters = Math.min(
        sentence.length,
        resources.visibleCharacters + CHARACTERS_PER_TICK,
      );
      setPartialTranscript(sentence.slice(0, resources.visibleCharacters));
      queueStep(CHARACTER_INTERVAL_MS);
      return;
    }

    resources.submitting = true;
    Promise.resolve(onSentenceRef.current(sentence))
      .then((accepted) => {
        if (resourcesRef.current !== resources) return;
        resources.submitting = false;
        if (!accepted) {
          setError("TXT 데모 문장을 transcript API로 보내지 못했습니다.");
          setPhase("error");
          return;
        }

        resources.sentenceIndex += 1;
        resources.visibleCharacters = 0;
        setCompletedSentences(resources.sentenceIndex);
        setPartialTranscript("");
        if (resources.sentenceIndex >= resources.sentences.length) {
          setPhase("ended");
          return;
        }
        queueStep(SENTENCE_GAP_MS);
      })
      .catch((submitError) => {
        if (resourcesRef.current !== resources) return;
        resources.submitting = false;
        setError(
          submitError instanceof Error
            ? submitError.message
            : "TXT 데모 문장을 transcript API로 보내지 못했습니다.",
        );
        setPhase("error");
      });
  }, [queueStep]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const prepare = useCallback(
    async (file: File) => {
      releaseResources(true);
      setPhase("preparing");
      setError(null);
      try {
        const sentences = splitTextIntoSentences(await file.text());
        if (sentences.length === 0) {
          throw new Error("읽을 문장이 없는 TXT 파일입니다.");
        }
        resourcesRef.current = {
          sentences,
          sentenceIndex: 0,
          visibleCharacters: 0,
          paused: false,
          submitting: false,
          timer: null,
        };
        setSentenceCount(sentences.length);
        setCompletedSentences(0);
        setPartialTranscript("");
        setPhase("ready");
      } catch (prepareError) {
        const message = prepareError instanceof Error
          ? prepareError.message
          : "TXT 데모 원고를 읽지 못했습니다.";
        setError(message);
        setPhase("error");
        throw prepareError;
      }
    },
    [releaseResources],
  );

  const play = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources) throw new Error("준비된 TXT 데모 입력이 없습니다.");
    resources.paused = false;
    setPhase("playing");
    queueStep(0);
  }, [queueStep]);

  const togglePause = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources || phase === "ended" || phase === "error") return;
    if (resources.paused) {
      resources.paused = false;
      setPhase("playing");
      queueStep(0);
      return;
    }
    resources.paused = true;
    clearTimer(resources);
    setPhase("paused");
  }, [clearTimer, phase, queueStep]);

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
    sentenceCount,
    completedSentences,
    partialTranscript,
    error,
  };
}
