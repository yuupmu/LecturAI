import assert from "node:assert/strict";
import {
  searchClaimEvidence,
  WEB_SEARCH_ENABLED,
} from "../src/backend/search/openai-web-search";

// Phase one must fail closed before creating any network request.

async function main(): Promise<void> {
  assert.equal(WEB_SEARCH_ENABLED, false);
  await assert.rejects(
    searchClaimEvidence({
      lectureClaim: "검증하지 않습니다.",
      slideClaim: "외부 검색은 후속 단계입니다.",
      query: "this query must never leave the process",
      slidePage: null,
    }),
    /WEB_SEARCH_DISABLED_PHASE_1/,
  );
  console.log("OpenAI web search is disabled for phase one");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
