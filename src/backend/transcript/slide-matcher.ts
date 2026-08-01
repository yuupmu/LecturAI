import type { Slide, SlideMap } from "../schemas";
import { normalizeText } from "./normalize-text";

export interface SlideMatch {
  slide: Slide;
  score: number;
}

// Lightweight phrase scoring narrows the agent context without embeddings.
export function matchSlides(
  text: string,
  slideMap: SlideMap,
  currentSlidePage: number | null,
): SlideMatch[] {
  const normalized = normalizeText(text);
  const tokens = new Set(normalized.split(" ").filter((word) => word.length >= 2));

  const scored = slideMap.slides.map((slide) => {
    let score = 0;
    const title = normalizeText(slide.title);
    if (title && normalized.includes(title)) score += 4;

    for (const keyword of slide.keywords) {
      const value = normalizeText(keyword);
      if (value && normalized.includes(value)) score += 2;
    }
    for (const concept of slide.keyConcepts) {
      const value = normalizeText(concept);
      if (value && normalized.includes(value)) score += 2;
    }
    for (const claim of slide.factualClaims) {
      const claimWords = new Set(
        normalizeText(claim.text)
          .split(" ")
          .filter((word) => word.length >= 2),
      );
      for (const word of claimWords) {
        if (tokens.has(word)) score += 1;
      }
    }
    return { slide, score };
  });

  scored.sort((a, b) => b.score - a.score || a.slide.page - b.slide.page);
  if ((scored[0]?.score ?? 0) > 0) return scored.slice(0, 3);

  const current = scored.find((entry) => entry.slide.page === currentSlidePage);
  return current ? [current] : [];
}
