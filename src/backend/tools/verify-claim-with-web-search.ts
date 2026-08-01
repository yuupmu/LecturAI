import { randomUUID } from "node:crypto";
import { tool } from "@openai/agents";
import { recordSessionError } from "../logs/error-log";
import { appendRawLog } from "../logs/raw-log";
import { synthesizeVerification } from "../review/synthesize-verification";
import {
  VerifyClaimArgsSchema,
  type ActionControl,
  type LectureSession,
  type VerificationEvent,
} from "../schemas";
import { searchClaimEvidence } from "../search/openai-web-search";
import { touchSession } from "../session-store";
import { normalizeText } from "../transcript/normalize-text";

const TOOL_NAME = "verify_claim_with_web_search";
const FAILURE_EXPLANATION =
  "자료와 발화가 서로 다르지만 외부 근거를 시간 내 확인하지 못했습니다. 추가 확인이 필요합니다.";

// Store searching first, then complete one mandatory OpenAI web search in place.
export function createVerifyClaimWithWebSearchTool(
  session: LectureSession,
  control: ActionControl,
) {
  return tool({
    name: TOOL_NAME,
    description:
      "Search the web only when NEW_TRANSCRIPT contains a concrete factual claim that conflicts with supplied slide material or needs external verification to prevent a learner misconception.",
    parameters: VerifyClaimArgsSchema,
    execute: async (input) => {
      const args = VerifyClaimArgsSchema.parse(input);

      if (control.actionTaken) {
        appendRawLog(session, "tool_call", TOOL_NAME, args);
        const result = { status: "action_limit_ignored" as const };
        appendRawLog(session, "tool_result", TOOL_NAME, result);
        return result;
      }
      control.actionTaken = true;
      control.action = TOOL_NAME;

      const eventKey = [
        "verification",
        args.slidePage,
        normalizeText(args.lectureClaim),
        normalizeText(args.slideClaim),
      ].join(":");
      if (session.eventKeys.has(eventKey)) {
        appendRawLog(session, "tool_call", TOOL_NAME, args);
        const result = { status: "duplicate_ignored" as const };
        appendRawLog(session, "tool_result", TOOL_NAME, result);
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
        status: "searching",
        sources: [],
        verdict: null,
        explanation: "OpenAI 웹 검색으로 외부 근거를 확인하고 있습니다.",
        correctedStatement: "",
        createdAt: now,
        updatedAt: now,
      };
      session.eventKeys.add(eventKey);
      session.events.push(event);
      touchSession(session);
      appendRawLog(session, "tool_call", TOOL_NAME, args);

      try {
        const searchResult = await searchClaimEvidence(args);
        for (const searchCall of searchResult.searchCalls) {
          appendRawLog(
            session,
            "agent_stream",
            "openai_web_search_call",
            searchCall,
          );
        }
        event.sources = searchResult.sources;

        try {
          const synthesis = await synthesizeVerification(args, {
            answer: searchResult.answer,
            sources: searchResult.sources,
          });
          event.verdict = synthesis.verdict;
          event.explanation = synthesis.explanation;
          event.correctedStatement = synthesis.correctedStatement;
        } catch (error) {
          event.verdict = "insufficient";
          event.explanation =
            "외부 검색 결과를 확보했지만 자동 판정에 실패했습니다. 표시된 출처를 직접 확인해 주세요.";
          event.correctedStatement = event.slideClaim;
          recordSessionError(session, "synthesize_verification", error, {
            eventId: event.id,
            rawResponseId: searchResult.rawResponseId,
          });
        }

        event.status = "complete";
        event.updatedAt = new Date().toISOString();
        touchSession(session);
      } catch (error) {
        event.status = "failed";
        event.verdict = "insufficient";
        event.explanation = FAILURE_EXPLANATION;
        event.correctedStatement = event.slideClaim;
        event.sources = [];
        event.updatedAt = new Date().toISOString();
        touchSession(session);
        recordSessionError(session, TOOL_NAME, error, { eventId: event.id });
      }

      const result = {
        status: event.status,
        verdict: event.verdict,
        explanation: event.explanation,
        sources: event.sources,
        event,
      };
      appendRawLog(session, "tool_result", TOOL_NAME, result);
      return result;
    },
  });
}
