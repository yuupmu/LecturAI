"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getRawLogs } from "@/frontend/api";
import {
  captureClientError,
  type ClientErrorLog,
} from "@/frontend/error-log";
import type { RawLogDto } from "@/frontend/types";
import styles from "./raw.module.css";

// Raw Signal Window keeps the payload untouched and follows only near the bottom.
export default function RawSignalPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  return <RawSessionSignal key={sessionId} sessionId={sessionId} />;
}

function RawSessionSignal({ sessionId }: { sessionId: string }) {
  const [logs, setLogs] = useState<RawLogDto[]>([]);
  const [cursor, setCursor] = useState(0);
  const [connection, setConnection] = useState<"connecting" | "live" | "delayed">(
    "connecting",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ClientErrorLog | null>(null);
  const cursorRef = useRef(0);
  const failureLoggedRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    cursorRef.current = 0;

    const poll = async () => {
      controller = new AbortController();
      const scroller = scrollerRef.current;
      const shouldFollow = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
        : true;
      try {
        const response = await getRawLogs(
          sessionId,
          cursorRef.current,
          controller.signal,
        );
        if (!active) return;
        cursorRef.current = response.nextCursor;
        setCursor(response.nextCursor);
        setConnection("live");
        setMessage(null);
        setErrorLog(null);
        failureLoggedRef.current = false;
        if (response.logs.length > 0) {
          setLogs((current) => [...current, ...response.logs]);
          if (shouldFollow) {
            requestAnimationFrame(() => {
              const target = scrollerRef.current;
              if (target) target.scrollTop = target.scrollHeight;
            });
          }
        }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setConnection("delayed");
        setMessage("원시 신호 동기화가 잠시 지연되고 있습니다. 자동으로 다시 연결합니다.");
        if (!failureLoggedRef.current) {
          failureLoggedRef.current = true;
          setErrorLog(captureClientError("raw.polling", error));
        }
      } finally {
        if (active) timeoutId = setTimeout(poll, 320);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [sessionId]);

  return (
    <main className={styles.rawPage}>
      <header className={styles.rawHeader}>
        <div>
          <span>LECTURAI / RAW SIGNAL WINDOW</span>
          <h1>Agent trace, without translation.</h1>
        </div>
        <div className={styles.rawStatus} aria-live="polite">
          <span className={styles[connection]} />
          <strong>{connection.toUpperCase()}</strong>
          <small>{logs.length} SIGNALS</small>
        </div>
      </header>

      <div className={styles.sessionLine}>
        <span>SESSION</span>
        <code>{sessionId}</code>
        <span>CURSOR</span>
        <code>{String(cursor).padStart(6, "0")}</code>
      </div>

      {message && (
        <div className={styles.rawDiagnostics}>
          <p className={styles.rawWarning} role="status">{message}</p>
          {errorLog && (
            <details>
              <summary>ERROR LOG · {errorLog.scope}</summary>
              <pre>{JSON.stringify(errorLog, null, 2)}</pre>
            </details>
          )}
        </div>
      )}

      <div className={styles.logScroller} ref={scrollerRef}>
        {logs.length === 0 ? (
          <div className={styles.awaiting}>
            <span>AWAITING SIGNAL</span>
            <p>Agent와 Tool의 첫 원시 이벤트를 기다리고 있습니다.</p>
          </div>
        ) : (
          <ol className={styles.logList}>
            {logs.map((log) => (
              <li
                key={log.cursor}
                className={styles[`category_${log.category}`]}
              >
                <header>
                  <time>{formatTimestamp(log.timestamp)}</time>
                  <span>{log.category}</span>
                  <strong>{log.name}</strong>
                  <small>#{String(log.cursor).padStart(5, "0")}</small>
                </header>
                <pre>{JSON.stringify(log.payload, null, 2)}</pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hour12: false,
      }).format(date);
}
