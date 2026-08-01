import type { Slide, SlideMap } from "../schemas";
import { normalizeText, tokenizeForMatch } from "./normalize-text";

export interface SlideMatch {
  slide: Slide;
  score: number;
  contentScore: number;
}

export interface TransitionCues {
  direction: "forward" | "backward" | null;
  phrases: string[];
}

const FORWARD_CUES = [
  "다음 슬라이드",
  "다음으로 넘어",
  "이제 다음",
  "이번에는",
  "다음 주제",
  "이제",
  "next slide",
  "moving on",
  "next topic",
];

const BACKWARD_CUES = [
  "앞에서 설명",
  "앞의 내용",
  "이전 슬라이드",
  "다시 돌아가",
  "앞으로 돌아가",
  "as mentioned earlier",
  "previous slide",
  "go back",
];

export function detectTransitionCues(text: string): TransitionCues {
  const normalized = normalizeText(text);
  const forward = FORWARD_CUES.filter((cue) =>
    normalized.includes(normalizeText(cue)),
  );
  const backward = BACKWARD_CUES.filter((cue) =>
    normalized.includes(normalizeText(cue)),
  );
  return {
    direction: forward.length > 0 ? "forward" : backward.length > 0 ? "backward" : null,
    phrases: [...forward, ...backward],
  };
}

// Scores all slides from recent completed context while preserving deterministic ranking.
export function scoreSlideCandidates(
  texts: string[],
  slideMap: SlideMap,
  currentSlidePage: number | null,
  cues: TransitionCues,
): SlideMatch[] {
  const weightedTexts = texts.map((text, index) => ({
    normalized: normalizeText(text),
    tokens: new Set(tokenizeForMatch(text)),
    weight: index === texts.length - 1
      ? 1
      : index === texts.length - 2
        ? 0.2
        : 0.1,
  }));
  const pages = slideMap.slides.map((slide) => slide.page).sort((a, b) => a - b);
  const currentIndex = pages.indexOf(currentSlidePage ?? -1);
  const forwardPage = currentIndex >= 0 ? pages[currentIndex + 1] : undefined;
  const backwardPage = currentIndex > 0 ? pages[currentIndex - 1] : undefined;

  const scored = slideMap.slides.map((slide) => {
    let contentScore = 0;
    for (const text of weightedTexts) {
      if (phraseMatches(text.normalized, text.tokens, slide.title)) {
        contentScore += 6 * text.weight;
      }
      for (const concept of slide.keyConcepts) {
        if (phraseMatches(text.normalized, text.tokens, concept)) {
          contentScore += 4 * text.weight;
        }
      }
      for (const keyword of slide.keywords) {
        if (phraseMatches(text.normalized, text.tokens, keyword)) {
          contentScore += 3 * text.weight;
        }
      }
      for (const claim of slide.factualClaims) {
        const claimTokens = new Set(tokenizeForMatch(claim.text));
        for (const word of claimTokens) {
          if (text.tokens.has(word)) contentScore += text.weight;
        }
      }
    }

    let score = contentScore;
    if (slide.page === currentSlidePage && cues.direction !== "forward") score += 2;
    if (cues.direction === "forward" && slide.page === forwardPage) score += 3;
    if (cues.direction === "backward" && slide.page === backwardPage) score += 3;
    return { slide, score, contentScore };
  });

  return scored.sort((a, b) => b.score - a.score || a.slide.page - b.slide.page);
}

// Lightweight phrase scoring narrows the agent context without embeddings.
export function matchSlides(
  text: string,
  slideMap: SlideMap,
  currentSlidePage: number | null,
): SlideMatch[] {
  const cues = detectTransitionCues(text);
  const scored = scoreSlideCandidates([text], slideMap, currentSlidePage, cues);
  if ((scored[0]?.score ?? 0) > 0) return scored.slice(0, 3);

  const current = scored.find((entry) => entry.slide.page === currentSlidePage);
  return current ? [current] : [];
}

function phraseMatches(
  normalizedText: string,
  transcriptTokens: Set<string>,
  phrase: string,
): boolean {
  const normalizedPhrase = normalizeText(phrase);
  const phraseTokens = tokenizeForMatch(phrase);
  if (!normalizedPhrase || phraseTokens.length === 0) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;
  const compactText = normalizedText.replaceAll(" ", "");
  const compactPhrase = normalizedPhrase.replaceAll(" ", "");
  if (compactPhrase.length >= 4 && compactText.includes(compactPhrase)) return true;
  const matches = phraseTokens.filter((token) => transcriptTokens.has(token)).length;
  const embeddedMatches = phraseTokens.filter((token) =>
    compactText.includes(token),
  ).length;
  return Math.max(matches, embeddedMatches) >=
    Math.max(1, Math.ceil(phraseTokens.length * 0.7));
}
