"use client";

import { useEffect, useRef, useState } from "react";
import { getSessionState } from "./api";
import { captureClientError, type ClientErrorLog } from "./error-log";
import type { SessionStateDto } from "./types";

// Recursive polling starts the next request only after the previous one settles.
export function useSessionPolling(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<{
    sessionId: string;
    state: SessionStateDto;
  } | null>(null);
  const [delayedSessionId, setDelayedSessionId] = useState<string | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{
    sessionId: string;
    log: ClientErrorLog;
  } | null>(null);
  const versionRef = useRef<{ sessionId: string; version: number } | null>(null);
  const loggedFailureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      try {
        const nextState = await getSessionState(sessionId, controller.signal);
        if (!active) return;
        setDelayedSessionId((current) =>
          current === sessionId ? null : current,
        );
        setErrorSnapshot((current) =>
          current?.sessionId === sessionId ? null : current,
        );
        loggedFailureRef.current = null;
        if (
          versionRef.current?.sessionId !== sessionId ||
          versionRef.current.version !== nextState.version
        ) {
          versionRef.current = { sessionId, version: nextState.version };
          setSnapshot({ sessionId, state: nextState });
        }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setDelayedSessionId(sessionId);
        if (loggedFailureRef.current !== sessionId) {
          loggedFailureRef.current = sessionId;
          setErrorSnapshot({
            sessionId,
            log: captureClientError("session.polling", error),
          });
        }
      } finally {
        if (active) timeoutId = setTimeout(poll, 350);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [sessionId]);

  return {
    state: snapshot?.sessionId === sessionId ? snapshot.state : null,
    delayed: delayedSessionId === sessionId,
    errorLog:
      errorSnapshot?.sessionId === sessionId ? errorSnapshot.log : null,
  };
}
