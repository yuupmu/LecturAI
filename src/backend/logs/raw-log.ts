import { randomUUID } from "node:crypto";
import type { LectureSession, RawLog } from "../schemas";
import { RawLogSchema } from "../schemas";

// Convert SDK events to JSON-safe snapshots before retaining them in memory.
function jsonSafe(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, nested: unknown) => {
        if (typeof nested === "bigint") return nested.toString();
        if (typeof nested === "object" && nested !== null) {
          if (seen.has(nested)) return "[Circular]";
          seen.add(nested);
        }
        return nested;
      }),
    ) as unknown;
  } catch {
    return { unserializable: true, id: randomUUID() };
  }
}

export function appendRawLog(
  session: LectureSession,
  category: RawLog["category"],
  name: string,
  payload: unknown,
): RawLog {
  const log = RawLogSchema.parse({
    cursor: session.rawLogs.length + 1,
    timestamp: new Date().toISOString(),
    category,
    name,
    payload: jsonSafe(payload),
  });
  session.rawLogs.push(log);
  return log;
}
