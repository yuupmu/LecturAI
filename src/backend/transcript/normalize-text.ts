// Normalization is deliberately simple and deterministic for demo deduplication.
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const GENERIC_MATCH_TERMS = new Set([
  "중요",
  "내용",
  "문제",
  "방법",
  "설명",
  "결과",
  "부분",
  "경우",
  "이것",
  "저것",
  "thing",
  "content",
  "problem",
  "method",
  "result",
  "example",
  "this",
  "that",
  "the",
  "and",
  "for",
  "with",
]);

// Matching tokens remove common Korean particles and low-signal lecture words.
export function tokenizeForMatch(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => stripKoreanParticle(token))
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_MATCH_TERMS.has(token) &&
        !/^\d+$/.test(token),
    );
}

function stripKoreanParticle(token: string): string {
  if (token.length < 3) return token;
  return token.replace(
    /(에게서|한테서|으로부터|에서부터|까지는|에서는|으로는|에게|한테|부터|까지|에서|으로|께서|이라|라고|에는|와는|과는|은|는|이|가|을|를|의|에|로|와|과|도|만)$/u,
    "",
  );
}
