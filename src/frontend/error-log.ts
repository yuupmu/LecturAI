import { ApiError } from "./api";

export interface ClientErrorLog {
  timestamp: string;
  scope: string;
  name: string;
  message: string;
  status?: number;
  stack?: string;
  payload?: unknown;
}

// Keeps browser failures visible both in DevTools and an inline details panel.
export function captureClientError(
  scope: string,
  error: unknown,
): ClientErrorLog {
  const normalized: ClientErrorLog = error instanceof Error
    ? {
        timestamp: new Date().toISOString(),
        scope,
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
        ...(error instanceof ApiError
          ? { status: error.status, payload: error.payload }
          : {}),
      }
    : {
        timestamp: new Date().toISOString(),
        scope,
        name: "NonErrorThrown",
        message: stringifyUnknown(error),
      };
  console.error("[LecturAI:error]", normalized);
  return normalized;
}

function stringifyUnknown(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
