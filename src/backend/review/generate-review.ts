import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { recordSessionError } from "../logs/error-log";
import { getOpenAIClient } from "../openai-client";
import {
  GeneratedReviewSchema,
  ReviewSchema,
  type LectureSession,
  type Review,
} from "../schemas";

// Produces exactly three questions and falls back to deterministic short answers.
export async function generateReview(
  session: LectureSession,
): Promise<Review> {
  const emphasis = session.events.filter((event) => event.type === "emphasis");
  const verification = session.events.filter(
    (event) => event.type === "verification",
  );
  const claims = session.slideMap.slides.flatMap((slide) =>
    slide.factualClaims.map((claim) => ({ page: slide.page, ...claim })),
  );

  try {
    const response = await getOpenAIClient().responses.parse({
      model: getEnv().OPENAI_FAST_MODEL,
      input: [
        {
          role: "system",
          content: [
            "Create exactly three review questions in the session language.",
            "Use emphasis events first.",
            "When verification events exist, include a question about the correct concept.",
            "Every question must include question, choices, answer, explanation, slidePage, and basisEventIds.",
            "Use only the supplied events and slide claims.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ emphasis, verification, claims }),
        },
      ],
      text: {
        format: zodTextFormat(GeneratedReviewSchema, "lecture_review"),
      },
    });
    if (!response.output_parsed) throw new Error("REVIEW_EMPTY_OUTPUT");
    const generated = GeneratedReviewSchema.parse(response.output_parsed);
    if (
      verification.length > 0 &&
      !generated.questions.some((question) =>
        verification.some((event) =>
          question.basisEventIds.includes(event.id),
        ),
      )
    ) {
      throw new Error("REVIEW_MISSING_VERIFICATION_QUESTION");
    }
    return ReviewSchema.parse({
      generatedAt: new Date().toISOString(),
      questions: generated.questions,
    });
  } catch (error) {
    recordSessionError(session, "review_generation_fallback", error, {
      emphasisCount: emphasis.length,
      verificationCount: verification.length,
      claimCount: claims.length,
    });
    return fallbackReview(session);
  }
}

function fallbackReview(session: LectureSession): Review {
  const emphasis = session.events.filter((event) => event.type === "emphasis");
  const verification = session.events.filter(
    (event) => event.type === "verification",
  );
  const claims = session.slideMap.slides.flatMap((slide) =>
    slide.factualClaims.map((claim) => ({
      page: slide.page,
      text: claim.text,
      eventId: "",
    })),
  );
  const emphasisCandidates = emphasis.map((event) => ({
      page: event.slidePage,
      text: event.concept,
      eventId: event.id,
    }));
  const verificationCandidates = verification.map((event) => ({
      page: event.slidePage,
      text: event.correctedStatement || event.slideClaim,
      eventId: event.id,
    }));
  const candidates = verificationCandidates.length > 0
    ? [
        ...emphasisCandidates.slice(0, 2),
        verificationCandidates[0],
        ...emphasisCandidates.slice(2),
        ...verificationCandidates.slice(1),
        ...claims,
      ]
    : [...emphasisCandidates, ...claims];
  const defaultPage = session.slideMap.slides[0]?.page ?? 1;

  while (candidates.length < 3) {
    candidates.push({
      page: defaultPage,
      text: session.slideMap.documentSummary || "강의의 핵심 내용을 설명하세요.",
      eventId: "",
    });
  }

  return ReviewSchema.parse({
    generatedAt: new Date().toISOString(),
    questions: candidates.slice(0, 3).map((candidate, index) => ({
      question: `복습 ${index + 1}: 다음 핵심 내용을 설명하세요: ${candidate.text}`,
      choices: [],
      answer: candidate.text,
      explanation: `슬라이드 ${candidate.page}의 강의 근거를 바탕으로 한 단답형 문제입니다.`,
      slidePage: candidate.page,
      basisEventIds: candidate.eventId ? [candidate.eventId] : [],
    })),
  });
}
