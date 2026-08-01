import { z } from "zod";

// Browser-safe DTO schemas mirror only the public API contract.
export const FactualClaimDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(["definition", "fact", "formula", "process"]),
});

export const SlideDtoSchema = z.object({
  page: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  keyConcepts: z.array(z.string()),
  factualClaims: z.array(FactualClaimDtoSchema),
  keywords: z.array(z.string()),
});

export const SlideMapDtoSchema = z.object({
  documentTitle: z.string(),
  documentSummary: z.string(),
  language: z.string(),
  globalKeywords: z.array(z.string()),
  slides: z.array(SlideDtoSchema),
});

export const TranscriptDtoSchema = z.object({
  itemId: z.string(),
  sequence: z.number().int().nonnegative(),
  text: z.string(),
  source: z.enum(["realtime", "typed", "replay"]),
  receivedAt: z.string(),
  matchedSlidePages: z.array(z.number().int().positive()),
});

export const LinerSourceDtoSchema = z.object({
  title: z.string(),
  url: z.string(),
  hostname: z.string(),
  description: z.string(),
  date: z.string().nullable(),
});

export const EmphasisEventDtoSchema = z.object({
  id: z.string(),
  type: z.literal("emphasis"),
  quote: z.string(),
  concept: z.string(),
  slidePage: z.number().int().positive(),
  createdAt: z.string(),
});

export const VerificationEventDtoSchema = z.object({
  id: z.string(),
  type: z.literal("verification"),
  lectureClaim: z.string(),
  slideClaim: z.string(),
  slidePage: z.number().int().positive(),
  query: z.string(),
  searchMode: z.enum(["web", "scholar"]),
  status: z.enum(["searching", "complete", "failed"]),
  sources: z.array(LinerSourceDtoSchema),
  verdict: z
    .enum(["supports_slide", "supports_lecture", "mixed", "insufficient"])
    .nullable(),
  explanation: z.string(),
  correctedStatement: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LectureEventDtoSchema = z.discriminatedUnion("type", [
  EmphasisEventDtoSchema,
  VerificationEventDtoSchema,
]);

export const ReviewQuestionDtoSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()),
  answer: z.string(),
  explanation: z.string(),
  slidePage: z.number().int().positive(),
  basisEventIds: z.array(z.string()),
});

export const ReviewDtoSchema = z.object({
  generatedAt: z.string(),
  questions: z.array(ReviewQuestionDtoSchema).length(3),
});

export const SessionStateDtoSchema = z.object({
  sessionId: z.string(),
  version: z.number().int(),
  status: z.enum(["preparing", "ready", "listening", "ended", "error"]),
  currentSlidePage: z.number().int().positive().nullable(),
  slideMap: SlideMapDtoSchema,
  transcripts: z.array(TranscriptDtoSchema),
  events: z.array(LectureEventDtoSchema),
  review: ReviewDtoSchema.nullable(),
});

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
  slideMap: SlideMapDtoSchema,
  transcriptionHints: z.object({
    prompt: z.string(),
    keywords: z.array(z.string()),
  }),
});

export const RealtimeTokenDtoSchema = z
  .object({
    value: z.string(),
    expires_at: z.number(),
    session: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const TranscriptActionSchema = z.enum([
  "none",
  "mark_emphasis",
  "verify_claim_with_liner",
  "finish_lesson",
]);

export const TranscriptResponseDtoSchema = z.object({
  action: TranscriptActionSchema,
  duplicate: z.boolean(),
  version: z.number().int(),
});

export const RawLogDtoSchema = z.object({
  cursor: z.number().int().positive(),
  timestamp: z.string(),
  category: z.enum([
    "agent_stream",
    "tool_call",
    "tool_result",
    "system",
    "error",
  ]),
  name: z.string(),
  payload: z.unknown(),
});

export const RawLogsResponseDtoSchema = z.object({
  logs: z.array(RawLogDtoSchema),
  nextCursor: z.number().int().nonnegative(),
});

export interface TranscriptInputDto {
  itemId: string;
  sequence: number;
  text: string;
  source: "realtime" | "typed" | "replay";
  receivedAt: string;
}

export type SlideMapDto = z.infer<typeof SlideMapDtoSchema>;
export type SlideDto = z.infer<typeof SlideDtoSchema>;
export type TranscriptDto = z.infer<typeof TranscriptDtoSchema>;
export type LectureEventDto = z.infer<typeof LectureEventDtoSchema>;
export type EmphasisEventDto = z.infer<typeof EmphasisEventDtoSchema>;
export type VerificationEventDto = z.infer<typeof VerificationEventDtoSchema>;
export type ReviewDto = z.infer<typeof ReviewDtoSchema>;
export type SessionStateDto = z.infer<typeof SessionStateDtoSchema>;
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;
export type RealtimeTokenDto = z.infer<typeof RealtimeTokenDtoSchema>;
export type TranscriptAction = z.infer<typeof TranscriptActionSchema>;
export type TranscriptResponseDto = z.infer<typeof TranscriptResponseDtoSchema>;
export type RawLogDto = z.infer<typeof RawLogDtoSchema>;
export type RawLogsResponseDto = z.infer<typeof RawLogsResponseDtoSchema>;

export type UiPhase =
  | "setup"
  | "requesting-permission"
  | "creating-session"
  | "connecting-realtime"
  | "live"
  | "ended"
  | "error";
