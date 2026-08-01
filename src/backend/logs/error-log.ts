import { randomUUID } from "node:crypto";
import type { LectureSession } from "../schemas";
import { appendRawLog } from "./raw-log";

export interface ServerErrorLog {
  errorId: string;
  timestamp: string;
  scope: string;
  context: Record<string, unknown>;
  error: {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
    issues?: unknown;
  };
}

// Produces one readable error record for terminal output and Raw Signal logs.
export function logServerError(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): ServerErrorLog {
  const details = normalizeError(error);
  const log: ServerErrorLog = {
    errorId: randomUUID(),
    timestamp: new Date().toISOString(),
    scope,
    context,
    error: details,
  };
  console.error(`[LecturAI:error] ${JSON.stringify(log, null, 2)}`);
  return log;
}

export function recordSessionError(
  session: LectureSession,
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): ServerErrorLog {
  const log = logServerError(scope, error, {
    sessionId: session.id,
    ...context,
  });
  appendRawLog(session, "error", scope, log);
  return log;
}

// API responses expose a safe pointer while full stacks stay in terminal/Raw logs.
export function publicErrorDiagnostic(log: ServerErrorLog) {
  return {
    errorId: log.errorId,
    timestamp: log.timestamp,
    scope: log.scope,
    message: log.error.message,
  };
}

function normalizeError(error: unknown): ServerErrorLog["error"] {
  if (!(error instanceof Error)) {
    return {
      name: "NonErrorThrown",
      message: safeStringify(error),
    };
  }

  const withIssues = error as Error & { issues?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause !== undefined
      ? { cause: normalizeCause(error.cause) }
      : {}),
    ...(withIssues.issues !== undefined ? { issues: withIssues.issues } : {}),
  };
}

function normalizeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return safeStringify(cause);
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
