import { randomUUID } from "node:crypto";
import { tool } from "@openai/agents";
import { appendRawLog } from "../logs/raw-log";
import { applyEmphasisToLiveNotes } from "../notes/synthesize-live-note";
import {
  MarkEmphasisArgsSchema,
  type ActionControl,
  type EmphasisEvent,
  type LectureSession,
  type Transcript,
} from "../schemas";
import { touchSession } from "../session-store";
import { normalizeText } from "../transcript/normalize-text";

export const MIN_EMPHASIS_CONFIDENCE = 0.78;

// Stores agent-resolved emphasis and rejects uncertain or duplicate concepts.
export function createMarkEmphasisTool(
  session: LectureSession,
  control: ActionControl,
  triggeringTranscript: Transcript,
) {
  return tool({
    name: "mark_emphasis",
    description:
      "Store high-confidence explicit or context-resolved learner emphasis triggered by NEW_TRANSCRIPT.",
    parameters: MarkEmphasisArgsSchema,
    execute: async (input) => {
      const args = MarkEmphasisArgsSchema.parse(input);
      appendRawLog(session, "tool_call", "mark_emphasis", args);

      if (control.actionTaken) {
        const result = { status: "action_limit_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }
      control.actionTaken = true;

      if (args.confidence < MIN_EMPHASIS_CONFIDENCE) {
        const result = { status: "low_confidence_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }

      if (!hasMatchingEmphasisEvidence(args.quote, args.evidenceType)) {
        const result = { status: "insufficient_evidence_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }

      const normalizedQuote = normalizeText(args.quote);
      if (
        !normalizedQuote ||
        !normalizeText(triggeringTranscript.text).includes(normalizedQuote)
      ) {
        const result = { status: "quote_not_in_new_transcript" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }

      const knownPages = new Set(session.slideMap.slides.map((slide) => slide.page));
      const resolvedSlidePage =
        args.slidePage !== null && knownPages.has(args.slidePage)
          ? args.slidePage
          : triggeringTranscript.matchedSlidePage ?? session.currentSlidePage;

      const normalizedConcept = normalizeText(args.resolvedConcept);
      const eventKey = `emphasis:${resolvedSlidePage ?? "none"}:${normalizedConcept}`;
      const similarEvent = session.events.find(
        (event) =>
          event.type === "emphasis" &&
          event.slidePage === resolvedSlidePage &&
          conceptsAreSimilar(event.resolvedConcept, args.resolvedConcept),
      );
      if (session.eventKeys.has(eventKey) || similarEvent) {
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(session, "tool_result", "mark_emphasis", result);
        return result;
      }

      const knownSequences = new Set(
        session.transcripts.map((transcript) => transcript.sequence),
      );
      const sourceSequences = Array.from(
        new Set(args.sourceSequences.filter((sequence) => knownSequences.has(sequence))),
      );
      if (!sourceSequences.includes(triggeringTranscript.sequence)) {
        sourceSequences.push(triggeringTranscript.sequence);
      }

      const event: EmphasisEvent = {
        id: randomUUID(),
        type: "emphasis",
        status: "complete",
        quote: args.quote,
        concept: args.resolvedConcept,
        resolvedConcept: args.resolvedConcept,
        emphasisKind: args.emphasisKind,
        evidenceType: args.evidenceType,
        confidence: args.confidence,
        reason: args.reason,
        slidePage: resolvedSlidePage,
        sourceSequences,
        createdAt: new Date().toISOString(),
      };
      session.eventKeys.add(eventKey);
      session.events.push(event);
      control.action = "mark_emphasis";
      applyEmphasisToLiveNotes(session);
      touchSession(session);

      const result = { status: "stored" as const, event };
      appendRawLog(session, "tool_result", "mark_emphasis", result);
      return result;
    },
  });
}

function hasMatchingEmphasisEvidence(
  quote: string,
  evidenceType: EmphasisEvent["evidenceType"],
): boolean {
  const normalized = normalizeText(quote);
  const negated = [
    /중요하지/u,
    /시험\S*\s*나오지/u,
    /기억할\s*필요\S*\s*없/u,
    /핵심\S*\s*아니/u,
    /강조하지/u,
    /not\s+important/u,
    /not\s+on\s+the\s+exam/u,
    /do\s+not\s+need\s+to\s+remember/u,
  ].some((pattern) => pattern.test(normalized));
  if (negated) return false;

  if (evidenceType === "repetition") {
    return /(다시|반복|거듭|재차|한\s*번\s*더|앞서\s*말한|방금\s*말한|핵심|기억|중요|강조|again|repeat|restate|remember|key\s*point|important)/u
      .test(normalized);
  }
  if (evidenceType === "correction") {
    return /(아니라|정정|바로잡|헷갈|착각|주의|not\s+.+\s+but|correction|confus)/u
      .test(normalized);
  }
  if (evidenceType === "contrast") {
    return /(차이|반면|대조|구분|아니라|중요|기억|시험|contrast|difference|distinguish|rather\s+than)/u
      .test(normalized);
  }
  return /(시험|꼭|반드시|기억|핵심|중요|주의|헷갈|강조|정정|아니라|구분|차이|exam|must|remember|important|key\s*point|caution|do\s+not\s+confuse)/u
    .test(normalized);
}

function conceptsAreSimilar(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(a.split(" ").filter((token) => token.length >= 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length >= 2));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.min(aTokens.size, bTokens.size) >= 0.8;
}
