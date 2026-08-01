import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { recordSessionError } from "../logs/error-log";
import { getOpenAIClient } from "../openai-client";
import {
  SlideResolutionSchema,
  SlideResolverOutputSchema,
  type LectureSession,
  type SlideResolution,
  type Transcript,
} from "../schemas";
import {
  detectTransitionCues,
  scoreSlideCandidates,
  type SlideMatch,
} from "./slide-matcher";

export const SWITCH_SCORE_MARGIN = 3;
export const MIN_SWITCH_CONFIDENCE = 0.58;
export const REQUIRED_CONSECUTIVE_HITS = 2;

export interface ActiveSlideResult {
  resolution: SlideResolution;
  candidates: SlideMatch[];
}

// Resolves the active page with deterministic hysteresis and rare LLM arbitration.
export async function resolveActiveSlide(
  session: LectureSession,
  newTranscript: Transcript,
): Promise<ActiveSlideResult> {
  const firstPage = session.slideMap.slides[0]?.page;
  const currentPage = session.currentSlidePage ?? firstPage;
  if (currentPage === undefined) {
    throw new Error("SLIDE_RESOLVER_NO_SLIDES");
  }
  if (session.slideMap.slides.length === 1) {
    session.pendingSlideCandidate = null;
    return {
      resolution: makeResolution(
        currentPage,
        1,
        "사용 가능한 강의 페이지가 하나뿐이라 현재 문맥을 유지합니다.",
        false,
        "kept_current",
      ),
      candidates: scoreSlideCandidates(
        [newTranscript.text],
        session.slideMap,
        currentPage,
        detectTransitionCues(newTranscript.text),
      ).slice(0, 3),
    };
  }

  const recentTranscripts = session.transcripts
    .filter((transcript) => transcript.itemId !== newTranscript.itemId)
    .slice(-2);
  const contextualTexts = [...recentTranscripts, newTranscript].map(
    (transcript) => transcript.text,
  );
  const cues = detectTransitionCues(newTranscript.text);
  const ranked = scoreSlideCandidates(
    contextualTexts,
    session.slideMap,
    currentPage,
    cues,
  );
  const top = ranked[0];
  const second = ranked[1];
  const current = ranked.find((candidate) => candidate.slide.page === currentPage);
  if (!top) {
    return {
      resolution: makeResolution(
        currentPage,
        0,
        "슬라이드 근거가 없어 현재 페이지를 유지합니다.",
        false,
        "kept_current",
      ),
      candidates: [],
    };
  }

  const confidence = lexicalConfidence(top, second);
  if (top.slide.page === currentPage) {
    const transitionStillAmbiguous =
      cues.direction !== null &&
      second !== undefined &&
      second.slide.page !== currentPage &&
      (second.contentScore >= 3 || Math.abs(top.score - second.score) <= 2);
    if (transitionStillAmbiguous) {
      const fallback = await resolveWithModel(
        session,
        currentPage,
        recentTranscripts,
        newTranscript,
        ranked,
        cues,
      );
      if (fallback) return fallback;
    }
    session.pendingSlideCandidate = null;
    return {
      resolution: makeResolution(
        currentPage,
        confidence,
        top.contentScore > 0
          ? "최근 발화가 현재 슬라이드의 개념과 가장 잘 이어집니다."
          : "새 슬라이드로 이동할 근거가 부족해 현재 페이지를 유지합니다.",
        false,
        "kept_current",
      ),
      candidates: ranked.slice(0, 3),
    };
  }

  const currentScore = current?.score ?? 0;
  const margin = top.score - currentScore;
  const explicitTransition = cues.direction !== null && top.contentScore >= 3;
  const strongNewTopic =
    (current?.contentScore ?? 0) === 0 &&
    top.contentScore >= 8 &&
    confidence >= MIN_SWITCH_CONFIDENCE;
  const hits = registerPendingCandidate(session, top.slide.page);
  const lexicalSwitch =
    top.contentScore > 0 &&
    margin >= SWITCH_SCORE_MARGIN &&
    confidence >= MIN_SWITCH_CONFIDENCE &&
    (explicitTransition || strongNewTopic || hits >= REQUIRED_CONSECUTIVE_HITS);

  if (lexicalSwitch) {
    session.pendingSlideCandidate = null;
    return {
      resolution: makeResolution(
        top.slide.page,
        confidence,
        explicitTransition
          ? `전환 표현과 ${top.slide.title || `페이지 ${top.slide.page}`} 주제 발화가 함께 감지됐습니다.`
          : `최근 발화가 ${top.slide.title || `페이지 ${top.slide.page}`}의 개념을 연속해서 설명하고 있습니다.`,
        true,
        "lexical",
      ),
      candidates: ranked.slice(0, 3),
    };
  }

  const closeTopScores =
    top.contentScore >= 3 && Math.abs(top.score - (second?.score ?? 0)) <= 2;
  const ambiguousAgainstCurrent = top.contentScore >= 3 && margin < SWITCH_SCORE_MARGIN;
  const sparseTransition = cues.direction !== null && top.contentScore < 6;
  if (closeTopScores || ambiguousAgainstCurrent || sparseTransition) {
    const fallback = await resolveWithModel(
      session,
      currentPage,
      recentTranscripts,
      newTranscript,
      ranked,
      cues,
    );
    if (fallback) return fallback;
  }

  return {
    resolution: makeResolution(
      currentPage,
      Math.max(0.2, confidence),
      hits > 1
        ? "새 주제 후보를 관찰 중이지만 전환 확신이 아직 충분하지 않습니다."
        : "한 번의 약한 주제 일치만으로 이동하지 않고 현재 페이지를 유지합니다.",
      false,
      "kept_current",
    ),
    candidates: ranked.slice(0, 3),
  };
}

function registerPendingCandidate(
  session: LectureSession,
  page: number,
): number {
  if (session.pendingSlideCandidate?.page === page) {
    session.pendingSlideCandidate.hits += 1;
  } else {
    session.pendingSlideCandidate = { page, hits: 1 };
  }
  return session.pendingSlideCandidate.hits;
}

async function resolveWithModel(
  session: LectureSession,
  currentPage: number,
  recentTranscripts: Transcript[],
  newTranscript: Transcript,
  ranked: SlideMatch[],
  cues: ReturnType<typeof detectTransitionCues>,
): Promise<ActiveSlideResult | null> {
  const candidateSlides = uniqueCandidates(ranked, currentPage);
  const allowedPages = new Set(candidateSlides.map((candidate) => candidate.slide.page));
  try {
    const response = await getOpenAIClient().responses.parse({
      model: getEnv().OPENAI_FAST_MODEL,
      input: [
        {
          role: "system",
          content: [
            "Select the slide the lecturer is actually explaining.",
            "Do not switch for one matching word.",
            "Keep the current slide when its context continues.",
            "Switch only when a new concept is being explained in earnest.",
            "When ambiguous, set shouldSwitch to false.",
            "selectedPage must be one of the supplied candidate pages.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            CURRENT_SLIDE: candidateSlides.find(
              (candidate) => candidate.slide.page === currentPage,
            )?.slide,
            RECENT_TRANSCRIPTS: [...recentTranscripts, newTranscript].slice(-3),
            TOP_CANDIDATE_SLIDES: candidateSlides.map((candidate) => ({
              score: candidate.score,
              contentScore: candidate.contentScore,
              slide: candidate.slide,
            })),
            TRANSITION_CUES: cues,
          }),
        },
      ],
      text: {
        format: zodTextFormat(SlideResolverOutputSchema, "slide_resolution"),
      },
    });
    if (!response.output_parsed) throw new Error("SLIDE_RESOLVER_EMPTY_OUTPUT");
    const output = SlideResolverOutputSchema.parse(response.output_parsed);
    if (!allowedPages.has(output.selectedPage)) {
      throw new Error("SLIDE_RESOLVER_SELECTED_OUTSIDE_CANDIDATES");
    }

    if (
      output.shouldSwitch &&
      output.selectedPage !== currentPage &&
      output.confidence >= MIN_SWITCH_CONFIDENCE
    ) {
      session.pendingSlideCandidate = null;
      return {
        resolution: makeResolution(
          output.selectedPage,
          output.confidence,
          output.reason,
          true,
          "llm_fallback",
        ),
        candidates: candidateSlides,
      };
    }
    return {
      resolution: makeResolution(
        currentPage,
        output.confidence,
        output.reason,
        false,
        "kept_current",
      ),
      candidates: candidateSlides,
    };
  } catch (error) {
    recordSessionError(session, "slide_resolver_fallback", error, {
      itemId: newTranscript.itemId,
      currentPage,
    });
    return null;
  }
}

function uniqueCandidates(ranked: SlideMatch[], currentPage: number): SlideMatch[] {
  const candidates = ranked.slice(0, 3);
  const current = ranked.find((candidate) => candidate.slide.page === currentPage);
  if (current && !candidates.some((candidate) => candidate.slide.page === currentPage)) {
    candidates.push(current);
  }
  return candidates;
}

function lexicalConfidence(top: SlideMatch, second: SlideMatch | undefined): number {
  if (top.score <= 0) return 0;
  const dominance = top.score / (top.score + (second?.score ?? 0) + 1);
  const strength = Math.min(1, top.contentScore / 8);
  return Math.min(0.99, Math.max(0, dominance * 0.45 + strength * 0.55));
}

function makeResolution(
  page: number,
  confidence: number,
  reason: string,
  changed: boolean,
  method: SlideResolution["method"],
): SlideResolution {
  return SlideResolutionSchema.parse({
    page,
    confidence: Math.min(1, Math.max(0, confidence)),
    reason,
    changed,
    method,
  });
}
