import { randomUUID } from "node:crypto";
import { tool } from "@openai/agents";
import { linerSearch } from "../liner/liner-search";
import { recordSessionError } from "../logs/error-log";
import { appendRawLog } from "../logs/raw-log";
import { synthesizeVerification } from "../review/synthesize-verification";
import {
  VerifyClaimArgsSchema,
  type ActionControl,
  type LectureSession,
  type VerificationEvent,
} from "../schemas";
import { touchSession } from "../session-store";
import { normalizeText } from "../transcript/normalize-text";

const FAILURE_EXPLANATION =
  "자료와 발화가 서로 다르지만 외부 근거를 시간 내 확인하지 못했습니다. 추가 확인이 필요합니다.";

// Records the searching state before performing one time-bounded Liner lookup.
export function createVerifyClaimTool(
  session: LectureSession,
  control: ActionControl,
) {
  return tool({
    name: "verify_claim_with_liner",
    description:
      "Verify a concrete factual claim only when NEW_TRANSCRIPT directly conflicts with a slide factualClaim.",
    parameters: VerifyClaimArgsSchema,
    execute: async (input) => {
      const args = VerifyClaimArgsSchema.parse(input);
      appendRawLog(session, "tool_call", "verify_claim_with_liner", args);

      if (control.actionTaken) {
        const result = { status: "action_limit_ignored" as const };
        appendRawLog(
          session,
          "tool_result",
          "verify_claim_with_liner",
          result,
        );
        return result;
      }
      control.actionTaken = true;
      control.action = "verify_claim_with_liner";

      const eventKey = [
        "verification",
        args.slidePage,
        normalizeText(args.lectureClaim),
        normalizeText(args.slideClaim),
      ].join(":");
      if (session.eventKeys.has(eventKey)) {
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(
          session,
          "tool_result",
          "verify_claim_with_liner",
          result,
        );
        return result;
      }

      const now = new Date().toISOString();
      const event: VerificationEvent = {
        id: randomUUID(),
        type: "verification",
        lectureClaim: args.lectureClaim,
        slideClaim: args.slideClaim,
        slidePage: args.slidePage,
        query: args.query,
        searchMode: args.searchMode,
        status: "searching",
        sources: [],
        verdict: null,
        explanation: "외부 근거를 검색하고 있습니다.",
        correctedStatement: "",
        createdAt: now,
        updatedAt: now,
      };
      session.eventKeys.add(eventKey);
      session.events.push(event);
      touchSession(session);

      try {
        event.sources = await linerSearch(args.query, args.searchMode);
      } catch (error) {
        event.status = "failed";
        event.explanation = FAILURE_EXPLANATION;
        event.correctedStatement = event.slideClaim;
        event.updatedAt = new Date().toISOString();
        touchSession(session);
        recordSessionError(session, "verify_claim_with_liner", error, {
          eventId: event.id,
          searchMode: args.searchMode,
        });
      }

      if (event.status !== "failed") {
        try {
          const synthesis = await synthesizeVerification(args, event.sources);
          event.verdict = synthesis.verdict;
          event.explanation = synthesis.explanation;
          event.correctedStatement = synthesis.correctedStatement;
        } catch (error) {
          event.verdict = "insufficient";
          event.explanation =
            "외부 검색 결과를 확보했지만 자동 요약에 실패했습니다. 출처를 직접 확인해 주세요.";
          event.correctedStatement = event.slideClaim;
          recordSessionError(session, "synthesize_verification", error, {
            eventId: event.id,
          });
        }
        event.status = "complete";
        event.updatedAt = new Date().toISOString();
        touchSession(session);
      }

      const result = { status: event.status, event };
      appendRawLog(
        session,
        "tool_result",
        "verify_claim_with_liner",
        result,
      );
      return result;
    },
  });
}
