import { z } from "zod";

// Shared Zod schemas are the single source of truth for API and model data.
export const FactualClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(["definition", "fact", "formula", "process"]),
});

export const SlideSchema = z.object({
  page: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  keyConcepts: z.array(z.string()),
  factualClaims: z.array(FactualClaimSchema).max(6),
  keywords: z.array(z.string()),
});

export const SlideMapSchema = z.object({
  documentTitle: z.string(),
  documentSummary: z.string(),
  language: z.string().min(1),
  globalKeywords: z.array(z.string()),
  slides: z.array(SlideSchema),
});

export const TranscriptInputSchema = z.object({
  itemId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  source: z.enum(["realtime", "typed", "replay"]),
  receivedAt: z.string().datetime({ offset: true }),
});

export const TranscriptSchema = TranscriptInputSchema.extend({
  matchedSlidePages: z.array(z.number().int().positive()),
});

export const LinerSourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  hostname: z.string(),
  description: z.string(),
  date: z.string().nullable(),
});

export const VerificationSynthesisSchema = z.object({
  verdict: z.enum([
    "supports_slide",
    "supports_lecture",
    "mixed",
    "insufficient",
  ]),
  explanation: z.string().min(1),
  correctedStatement: z.string().min(1),
});

export const EmphasisEventSchema = z.object({
  id: z.string(),
  type: z.literal("emphasis"),
  quote: z.string(),
  concept: z.string(),
  slidePage: z.number().int().positive(),
  createdAt: z.string(),
});

export const VerificationEventSchema = z.object({
  id: z.string(),
  type: z.literal("verification"),
  lectureClaim: z.string(),
  slideClaim: z.string(),
  slidePage: z.number().int().positive(),
  query: z.string(),
  searchMode: z.enum(["web", "scholar"]),
  status: z.enum(["searching", "complete", "failed"]),
  sources: z.array(LinerSourceSchema).max(3),
  verdict: VerificationSynthesisSchema.shape.verdict.nullable(),
  explanation: z.string(),
  correctedStatement: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LectureEventSchema = z.discriminatedUnion("type", [
  EmphasisEventSchema,
  VerificationEventSchema,
]);

export const ReviewQuestionSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.string()).max(5),
  answer: z.string().min(1),
  explanation: z.string().min(1),
  slidePage: z.number().int().positive(),
  basisEventIds: z.array(z.string()),
});

export const ReviewSchema = z.object({
  generatedAt: z.string(),
  questions: z.array(ReviewQuestionSchema).length(3),
});

export const GeneratedReviewSchema = z.object({
  questions: z.array(ReviewQuestionSchema).length(3),
});

export const RawLogSchema = z.object({
  cursor: z.number().int().positive(),
  timestamp: z.string(),
  category: z.enum(["agent_stream", "tool_call", "tool_result", "error"]),
  name: z.string(),
  payload: z.unknown(),
});

export const RealtimeTokenInputSchema = z.object({
  sessionId: z.string().uuid(),
});

export const RealtimeClientSecretResponseSchema = z
  .object({
    value: z.string().min(1),
    expires_at: z.number(),
    session: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const MarkEmphasisArgsSchema = z.object({
  quote: z.string().min(1),
  concept: z.string().min(1),
  slidePage: z.number().int().positive(),
});

export const VerifyClaimArgsSchema = z.object({
  lectureClaim: z.string().min(1),
  slideClaim: z.string().min(1),
  slidePage: z.number().int().positive(),
  query: z.string().min(1),
  searchMode: z.enum(["web", "scholar"]),
});

export const FinishLessonArgsSchema = z.object({
  closingQuote: z.string().min(1),
});

export type SlideMap = z.infer<typeof SlideMapSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type LectureEvent = z.infer<typeof LectureEventSchema>;
export type EmphasisEvent = z.infer<typeof EmphasisEventSchema>;
export type VerificationEvent = z.infer<typeof VerificationEventSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type RawLog = z.infer<typeof RawLogSchema>;

export type SessionStatus =
  | "preparing"
  | "ready"
  | "listening"
  | "ended"
  | "error";

export interface LectureSession {
  id: string;
  version: number;
  status: SessionStatus;
  instruction: string;
  language: string;
  slideMap: SlideMap;
  currentSlidePage: number | null;
  transcripts: Transcript[];
  events: LectureEvent[];
  review: Review | null;
  rawLogs: RawLog[];
  createdAt: string;
  updatedAt: string;
  processedItemIds: Set<string>;
  eventKeys: Set<string>;
  analysisChain: Promise<void>;
}

export type AgentActionName =
  | "none"
  | "mark_emphasis"
  | "verify_claim_with_liner"
  | "finish_lesson";

export interface ActionControl {
  actionTaken: boolean;
  action: AgentActionName;
}
