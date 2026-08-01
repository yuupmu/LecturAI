import assert from "node:assert/strict";
import { parseOpenAIWebSearchResponse } from "../src/backend/search/openai-web-search";

// These fixtures verify type-based parsing without making network requests.
const citation = (title: string, url: string) => ({
  type: "url_citation",
  title,
  url,
  start_index: 0,
  end_index: 4,
});
const message = (text: string, annotations: unknown[] = []) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations }],
});
const searchCall = (sources: unknown[] = []) => ({
  id: "ws_1",
  type: "web_search_call",
  status: "completed",
  action: { type: "search", queries: ["binary search"], sources },
});
const response = (output: unknown[], outputText = "") => ({
  id: "resp_1",
  output,
  output_text: outputText,
});

const searchBeforeMessage = parseOpenAIWebSearchResponse(response([
  searchCall(),
  message("검색 근거", [citation("MIT source", "https://mit.edu/search")]),
]));
assert.equal(searchBeforeMessage.searchCalls.length, 1);
assert.equal(searchBeforeMessage.answer, "검색 근거");

const messageIsNotFirst = parseOpenAIWebSearchResponse(response([
  { type: "reasoning", id: "reason_1", summary: [] },
  searchCall(),
  message("순서 무관"),
]));
assert.equal(messageIsNotFirst.answer, "순서 무관");

const multipleCitations = parseOpenAIWebSearchResponse(response([
  message("여러 인용", [
    citation("Source A", "https://example.com/a"),
    citation("Source B", "https://example.org/b"),
  ]),
  searchCall(),
]));
assert.deepEqual(
  multipleCitations.sources.map((source) => source.title),
  ["Source A", "Source B"],
);

const deduplicated = parseOpenAIWebSearchResponse(response([
  searchCall([{
    type: "url",
    url: "https://example.com/shared",
    title: "Action title",
    description: "Returned search description",
  }]),
  message("중복", [citation("Citation title", "https://example.com/shared")]),
]));
assert.equal(deduplicated.sources.length, 1);
assert.equal(deduplicated.sources[0]?.title, "Citation title");

const noCitations = parseOpenAIWebSearchResponse(response([
  searchCall([{ type: "url", url: "https://example.com/no-title" }]),
  message("인용 없음"),
]));
assert.deepEqual(noCitations.sources, []);

const emptyOutputText = parseOpenAIWebSearchResponse(response([
  searchCall(),
  message(""),
]));
assert.equal(emptyOutputText.answer, "");

const invalidUrl = parseOpenAIWebSearchResponse(response([
  searchCall(),
  message("잘못된 URL 제외", [citation("Invalid", "not-a-url")]),
]));
assert.deepEqual(invalidUrl.sources, []);

console.log("OpenAI web-search response parser tests passed");
