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

export const MaterialKnowledgeItemDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourcePage: z.number().int().positive(),
  sourceText: z.string(),
});

export const MaterialProcessDtoSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  steps: z.array(z.object({ order: z.number().int().positive(), text: z.string() })),
  sourcePage: z.number().int().positive(),
  sourceText: z.string(),
});

export const MaterialTopicDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  definitions: z.array(MaterialKnowledgeItemDtoSchema),
  conditions: z.array(MaterialKnowledgeItemDtoSchema),
  processes: z.array(MaterialProcessDtoSchema),
  formulas: z.array(MaterialKnowledgeItemDtoSchema),
  comparisons: z.array(MaterialKnowledgeItemDtoSchema),
  examples: z.array(MaterialKnowledgeItemDtoSchema),
  warnings: z.array(MaterialKnowledgeItemDtoSchema),
  sourcePages: z.array(z.number().int().positive()),
});

export const MaterialKnowledgeDtoSchema = z.object({
  title: z.string(),
  summary: z.string(),
  outline: z.array(MaterialTopicDtoSchema),
  terminology: z.array(z.object({
    term: z.string(),
    aliases: z.array(z.string()),
    definition: z.string().nullable(),
    sourcePages: z.array(z.number().int().positive()),
  })),
});

export const SlideResolutionDtoSchema = z.object({
  page: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  changed: z.boolean(),
  method: z.enum(["lexical", "llm_fallback", "kept_current"]),
});

export const TranscriptDtoSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  sequence: z.number().int().nonnegative(),
  text: z.string(),
  source: z.enum(["realtime", "manual"]),
  receivedAt: z.string(),
  startedAtMs: z.number().int().nonnegative().nullable(),
  endedAtMs: z.number().int().nonnegative().nullable(),
  matchedSlidePages: z.array(z.number().int().positive()),
  matchedSlidePage: z.number().int().positive().nullable().optional(),
  slideConfidence: z.number().min(0).max(1).optional(),
});

export const TranslationTargetLanguageDtoSchema = z.enum(["ko", "en"]);

export const TranslationSettingsDtoSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: TranslationTargetLanguageDtoSchema.nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const LiveTranslationSegmentDtoSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  sequence: z.number().int().nonnegative(),
  sourceText: z.string(),
  translatedText: z.string().nullable(),
  targetLanguage: TranslationTargetLanguageDtoSchema,
  status: z.enum(["translating", "complete", "failed"]),
  slidePage: z.number().int().positive().nullable(),
  settingsRevision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
});

export const KnowledgeImportanceDtoSchema = z.enum(["normal", "important", "exam"]);
export const KnowledgeUnitDtoSchema = z.object({
  id: z.string(),
  type: z.enum([
    "definition", "condition", "process", "formula", "complexity",
    "comparison", "example", "warning", "conclusion",
  ]),
  text: z.string(),
  order: z.number().int().positive().nullable(),
  importance: KnowledgeImportanceDtoSchema,
  sourceItemIds: z.array(z.string()),
  sourcePages: z.array(z.number().int().positive()),
  status: z.enum(["provisional", "confirmed"]),
});

export const PendingEmphasisDtoSchema = z.object({
  id: z.string(),
  importance: z.enum(["important", "exam"]),
  expectedCount: z.number().int().positive().nullable(),
  collectedKnowledgeUnitIds: z.array(z.string()),
  triggerItemIds: z.array(z.string()),
});

export const DeferredLectureStartDtoSchema = z.object({
  workingTitle: z.string().nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string()),
  knowledgeUnits: z.array(KnowledgeUnitDtoSchema),
});

export const OpenLectureUnitDtoSchema = z.object({
  id: z.string(),
  workingTitle: z.string().nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string()),
  provisionalKnowledge: z.array(KnowledgeUnitDtoSchema),
  pendingEmphasis: PendingEmphasisDtoSchema.nullable(),
  status: z.enum(["open", "closing_candidate"]),
  deferredStart: DeferredLectureStartDtoSchema.nullable(),
});

export const CompletedLectureUnitDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAtSequence: z.number().int().nonnegative(),
  endedAtSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string()),
  knowledgeUnits: z.array(KnowledgeUnitDtoSchema),
  noteId: z.string().nullable(),
});

export const LectureMemoryDtoSchema = z.object({
  revision: z.number().int().nonnegative(),
  currentUnit: OpenLectureUnitDtoSchema.nullable(),
  completedUnits: z.array(CompletedLectureUnitDtoSchema),
  recentTopicSummary: z.string(),
});

export const NoteItemDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  importance: KnowledgeImportanceDtoSchema,
  sourceItemIds: z.array(z.string()),
  sourcePages: z.array(z.number().int().positive()),
});

export const NoteSectionDtoSchema = z.object({
  id: z.string(),
  heading: z.string(),
  layout: z.enum(["bullets", "steps"]),
  items: z.array(NoteItemDtoSchema),
});

export const LectureNoteDtoSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  status: z.enum(["live", "final"]),
  title: z.string(),
  sections: z.array(NoteSectionDtoSchema),
  sourceItemIds: z.array(z.string()),
  sourcePages: z.array(z.number().int().positive()),
  processedThroughSequence: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const NoteGenerationTriggerDtoSchema = z.enum([
  "scheduled",
  "manual",
  "final",
]);

export const NoteGenerationStateDtoSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int().positive(),
  status: z.enum([
    "idle",
    "queued",
    "generating",
    "reviewing",
    "completed",
    "failed",
  ]),
  revision: z.number().int().nonnegative(),
  lastProcessedSequence: z.number().int().nonnegative(),
  processedItemIds: z.array(z.string()),
  lastGeneratedAt: z.string().nullable(),
  nextScheduledAt: z.string().nullable(),
  activeJobId: z.string().nullable(),
  activeTrigger: NoteGenerationTriggerDtoSchema.nullable(),
  pendingManualRequest: z.boolean(),
  lastError: z.string().nullable(),
  currentNote: LectureNoteDtoSchema.nullable(),
  finalNote: LectureNoteDtoSchema.nullable(),
});

export const LiveNoteBulletKindDtoSchema = z.enum([
  "concept",
  "definition",
  "process",
  "example",
  "comparison",
  "caution",
  "formula",
]);

export const LiveNoteBulletDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: LiveNoteBulletKindDtoSchema,
  emphasized: z.boolean(),
  sourceSequences: z.array(z.number().int().nonnegative()),
});

export const LiveNoteDtoSchema = z.object({
  id: z.string(),
  slidePage: z.number().int().positive().nullable(),
  title: z.string(),
  summary: z.string(),
  bullets: z.array(LiveNoteBulletDtoSchema),
  keyTerms: z.array(z.string()),
  lastProcessedSequence: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const LectureAssistantModeDtoSchema = z.enum([
  "question",
  "explain_selection",
]);

export const LectureAnswerBasisDtoSchema = z.enum([
  "lecture_only",
  "lecture_plus_general_knowledge",
  "general_knowledge",
]);

export const TranscriptSelectionIntentDtoSchema = z.enum([
  "explain",
  "simplify",
  "example",
  "define_terms",
]);

export const TranscriptSelectionDtoSchema = z.object({
  selectedText: z.string(),
  sourceItemIds: z.array(z.string()),
  startSequence: z.number().int().nonnegative(),
  endSequence: z.number().int().nonnegative(),
  kind: z.enum(["original", "translation"]).default("original"),
  targetLanguage: TranslationTargetLanguageDtoSchema.nullable().default(null),
  translationIds: z.array(z.string()).default([]),
  intent: TranscriptSelectionIntentDtoSchema.optional(),
});

export const LectureAssistantAnswerDtoSchema = z.object({
  title: z.string(),
  directAnswer: z.string(),
  explanation: z.string(),
  keyPoints: z.array(z.string()),
  example: z.string().nullable(),
  basis: LectureAnswerBasisDtoSchema,
  referencedItemIds: z.array(z.string()),
  answeredAt: z.string(),
});

export const LectureAssistantQuestionDtoSchema = z.object({
  id: z.string(),
  mode: LectureAssistantModeDtoSchema,
  question: z.string(),
  selection: TranscriptSelectionDtoSchema.nullable(),
  snapshotSequence: z.number().int().nonnegative(),
  createdAt: z.string(),
  status: z.enum(["queued", "answering", "answered", "failed"]),
  answer: LectureAssistantAnswerDtoSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const LectureAnswerEvidenceDtoSchema = z.object({
  type: z.enum(["material", "transcript", "structured_note", "open_unit"]),
  sourcePage: z.number().int().positive().nullable(),
  sourceItemIds: z.array(z.string()),
  noteId: z.string().nullable(),
  label: z.string(),
  excerpt: z.string(),
});

export const LectureAnswerDtoSchema = z.object({
  text: z.string(),
  shortAnswer: z.string(),
  keyPoints: z.array(z.string()),
  evidence: z.array(LectureAnswerEvidenceDtoSchema),
  basedOn: z.enum([
    "material_and_transcript",
    "material_only",
    "transcript_only",
    "notes_and_transcript",
  ]),
  styleProfileRevision: z.number().int().positive().nullable(),
  answeredAt: z.string(),
});

export const LectureQuestionDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  question: z.string(),
  selection: TranscriptSelectionDtoSchema.nullable().default(null),
  answerLanguage: TranslationTargetLanguageDtoSchema.nullable().default(null),
  askedAt: z.string(),
  askedAtSequence: z.number().int().nonnegative().nullable(),
  lectureRevision: z.number().int().nonnegative(),
  status: z.enum([
    "queued",
    "answering",
    "answered",
    "insufficient_context",
    "failed",
  ]),
  answer: LectureAnswerDtoSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const ProfessorStyleProfileDtoSchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  formality: z.enum(["formal", "casual", "mixed"]),
  explanationDensity: z.enum(["brief", "balanced", "detailed"]),
  sentenceLength: z.enum(["short", "mixed", "long"]),
  usesStepByStepExplanation: z.boolean(),
  usesAnalogies: z.boolean(),
  usesExamplesFrequently: z.boolean(),
  usesQuestionsRhetorically: z.boolean(),
  recurringPhrases: z.array(z.string()),
  emphasisPatterns: z.array(z.string()),
  transitionPatterns: z.array(z.string()),
  styleSummary: z.string(),
  sourceItemIds: z.array(z.string()),
});

export const AbsenceSummarySectionDtoSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  keyPoints: z.array(z.string()),
});

export const AbsenceSummaryDtoSchema = z.object({
  overview: z.string(),
  detailedSections: z.array(AbsenceSummarySectionDtoSchema),
  importantPoints: z.array(z.string()),
  currentLecturePosition: z.string(),
  suggestedReviewQuestions: z.array(z.string()),
  sourceItemIds: z.array(z.string()),
  sourceNoteIds: z.array(z.string()),
  sourcePages: z.array(z.number().int().positive()),
  generatedAt: z.string(),
  fallback: z.boolean(),
});

export const AbsenceSpanDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: z.enum(["active", "summarizing", "completed", "failed"]),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  endedAtSequence: z.number().int().nonnegative().nullable(),
  startedAtRevision: z.number().int().nonnegative(),
  endedAtRevision: z.number().int().nonnegative().nullable(),
  summary: AbsenceSummaryDtoSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const MissedFlowRecoveryDtoSchema = z.object({
  whatCameBefore: z.string(),
  whyThisCameNext: z.string(),
  requiredIdea: z.string(),
  resumeWith: z.string(),
  sourceItemIds: z.array(z.string()),
  sourcePages: z.array(z.number().int().positive()),
  generatedAt: z.string(),
  fallback: z.boolean(),
});

export const MissedFlowRequestDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: z.enum(["capturing", "generating", "completed", "failed"]),
  clickedAt: z.string(),
  captureEndsAt: z.string(),
  clickedAtSequence: z.number().int().nonnegative(),
  capturedThroughSequence: z.number().int().nonnegative().nullable(),
  recovery: MissedFlowRecoveryDtoSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const UnderstandingBranchMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  answer: LectureAssistantAnswerDtoSchema.nullable(),
  createdAt: z.string(),
});

export const UnderstandingRejoinPacketDtoSchema = z.object({
  quickRejoin: z.object({
    mustKnowNow: z.array(z.string()).max(3),
    currentTopic: z.string(),
    bridgeSentence: z.string(),
    listenForNext: z.string(),
  }),
  detailedCatchUp: z.object({
    branchSummary: z.string(),
    missedLectureSummary: z.string(),
    keyPoints: z.array(z.string()),
  }),
  missedItemIds: z.array(z.string()),
  understoodContent: z.array(z.string()),
  lectureProgress: z.array(z.string()),
  currentLecturePosition: z.string(),
  connection: z.string(),
  listenFor: z.array(z.string()),
  sourceItemIds: z.array(z.string()),
  rawTranscript: z.array(z.object({
    itemId: z.string(),
    sequence: z.number().int().nonnegative(),
    text: z.string(),
    receivedAt: z.string(),
  })),
  currentNoteSnapshot: LectureNoteDtoSchema.nullable(),
  generatedAt: z.string(),
  fallback: z.boolean(),
});

export const UnderstandingBranchDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: z.literal("immediate_understanding"),
  startSource: z.enum(["selection", "current_point", "deferred_question"]),
  focusText: z.string(),
  selection: TranscriptSelectionDtoSchema.nullable(),
  startedAt: z.string(),
  startedAtSequence: z.number().int().nonnegative(),
  startedAtRevision: z.number().int().nonnegative(),
  endedAt: z.string().nullable(),
  endedAtSequence: z.number().int().nonnegative().nullable(),
  status: z.enum(["active", "rejoining", "completed", "failed"]),
  explanationStatus: z.enum(["answering", "answered", "failed"]),
  messageStatus: z.enum(["idle", "answering"]),
  messages: z.array(UnderstandingBranchMessageDtoSchema),
  rejoinPacket: UnderstandingRejoinPacketDtoSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const DeferredQuestionDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  focusText: z.string(),
  question: z.string(),
  selection: TranscriptSelectionDtoSchema.nullable(),
  createdAt: z.string(),
  startedAtSequence: z.number().int().nonnegative(),
  startedAtRevision: z.number().int().nonnegative(),
  status: z.enum([
    "pending",
    "explained_by_lecture",
    "ai_explanation_available",
    "resolved",
    "failed",
  ]),
  checkStatus: z.enum(["idle", "checking"]),
  lastCheckedThroughSequence: z.number().int().nonnegative(),
  checkedAt: z.string().nullable(),
  checkCount: z.number().int().nonnegative(),
  lectureExplanation: z.string().nullable(),
  relatedItemIds: z.array(z.string()),
  relatedSequences: z.array(z.number().int().nonnegative()),
  resolvedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const LectureActivityStateDtoSchema = z.object({
  currentActivity: z.enum([
    "instruction", "example", "class_question", "class_administration",
    "off_topic", "break", "silence", "ending",
  ]),
  monitoringStartedAt: z.string().nullable(),
  lastSpeechAt: z.string().nullable(),
  lastMeaningfulInstructionAt: z.string().nullable(),
  endingCandidate: z.object({
    kind: z.enum(["explicit", "inactivity"]),
    detectedAt: z.string(),
    sourceItemIds: z.array(z.string()),
    reason: z.string(),
    expiresAt: z.string(),
  }).nullable(),
  inactivityCandidate: z.object({
    detectedAt: z.string(),
    lastMeaningfulInstructionAt: z.string(),
    expiresAt: z.string(),
  }).nullable(),
});

export const WebSearchSourceDtoSchema = z.object({
  title: z.string(),
  url: z.string(),
  hostname: z.string().optional(),
  description: z.string(),
});

export const EmphasisEventDtoSchema = z.object({
  id: z.string(),
  type: z.literal("emphasis"),
  status: z.literal("complete"),
  quote: z.string(),
  concept: z.string(),
  resolvedConcept: z.string(),
  emphasisKind: z.enum([
    "exam",
    "must_remember",
    "definition",
    "caution",
    "contrast",
    "repeated_focus",
  ]),
  evidenceType: z.enum([
    "explicit_phrase",
    "contextual_reference",
    "repetition",
    "correction",
    "contrast",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  slidePage: z.number().int().positive().nullable(),
  sourceSequences: z.array(z.number().int().nonnegative()),
  createdAt: z.string(),
});

export const VerificationEventDtoSchema = z.object({
  id: z.string(),
  type: z.literal("verification"),
  lectureClaim: z.string(),
  slideClaim: z.string(),
  slidePage: z.number().int().positive().nullable(),
  query: z.string(),
  status: z.enum(["searching", "complete", "failed"]),
  sources: z.array(WebSearchSourceDtoSchema),
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
  status: z.enum([
    "preparing",
    "ready",
    "listening",
    "ending_candidate",
    "inactivity_candidate",
    "finalizing",
    "ended",
    "error",
  ]),
  currentSlidePage: z.number().int().positive().nullable(),
  slideResolution: SlideResolutionDtoSchema.nullable(),
  slideMap: SlideMapDtoSchema,
  materialKnowledge: MaterialKnowledgeDtoSchema,
  transcripts: z.array(TranscriptDtoSchema),
  translationSettings: TranslationSettingsDtoSchema,
  translations: z.array(LiveTranslationSegmentDtoSchema),
  lectureMemory: LectureMemoryDtoSchema,
  lectureNotes: z.array(LectureNoteDtoSchema),
  noteGeneratingUnitIds: z.array(z.string()),
  noteGeneration: NoteGenerationStateDtoSchema,
  lectureRevision: z.number().int().nonnegative(),
  questions: z.array(LectureQuestionDtoSchema),
  professorStyleProfile: ProfessorStyleProfileDtoSchema.nullable(),
  absenceSpans: z.array(AbsenceSpanDtoSchema),
  missedFlowRequests: z.array(MissedFlowRequestDtoSchema),
  understandingBranches: z.array(UnderstandingBranchDtoSchema),
  deferredQuestions: z.array(DeferredQuestionDtoSchema),
  activityState: LectureActivityStateDtoSchema,
  assistantRequests: z.array(LectureAssistantQuestionDtoSchema),
  liveNotes: z.array(LiveNoteDtoSchema),
  events: z.array(LectureEventDtoSchema),
  review: ReviewDtoSchema.nullable(),
});

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
  slideMap: SlideMapDtoSchema,
  materialKnowledge: MaterialKnowledgeDtoSchema,
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
  "verify_claim_with_web_search",
  "finish_lesson",
]);

export const TranscriptResponseDtoSchema = z.object({
  action: TranscriptActionSchema,
  duplicate: z.boolean(),
  version: z.number().int(),
});

export const TranslationSettingsResponseDtoSchema = z.object({
  ok: z.literal(true),
  translationSettings: TranslationSettingsDtoSchema,
  version: z.number().int(),
});

export const AssistantRequestResponseDtoSchema = z.object({
  accepted: z.boolean(),
  requestId: z.string(),
  snapshotSequence: z.number().int().nonnegative(),
  status: z.enum(["queued", "answering", "answered", "failed"]),
});

export const QuestionRequestResponseDtoSchema = z.object({
  accepted: z.boolean(),
  questionId: z.string(),
  askedAtSequence: z.number().int().nonnegative().nullable(),
  lectureRevision: z.number().int().nonnegative(),
  status: z.enum(["queued", "answering", "answered", "insufficient_context", "failed"]),
});

export const AbsenceRequestResponseDtoSchema = z.object({
  accepted: z.boolean(),
  span: AbsenceSpanDtoSchema,
  message: z.string(),
});

export const MissedFlowRequestResponseDtoSchema = z.object({
  accepted: z.boolean(),
  request: MissedFlowRequestDtoSchema,
  message: z.string(),
});

export const UnderstandingBranchResponseDtoSchema = z.object({
  accepted: z.boolean(),
  branch: UnderstandingBranchDtoSchema,
  message: z.string(),
});

export const DeferredQuestionResponseDtoSchema = z.object({
  accepted: z.boolean(),
  question: DeferredQuestionDtoSchema,
  message: z.string(),
});

export const EndCancelResponseDtoSchema = z.object({
  accepted: z.boolean(),
  message: z.string(),
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
  source: "realtime" | "manual";
  receivedAt: string;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
}

export type SlideMapDto = z.infer<typeof SlideMapDtoSchema>;
export type SlideDto = z.infer<typeof SlideDtoSchema>;
export type MaterialKnowledgeDto = z.infer<typeof MaterialKnowledgeDtoSchema>;
export type SlideResolutionDto = z.infer<typeof SlideResolutionDtoSchema>;
export type TranscriptDto = z.infer<typeof TranscriptDtoSchema>;
export type TranslationTargetLanguageDto = z.infer<
  typeof TranslationTargetLanguageDtoSchema
>;
export type TranslationSettingsDto = z.infer<
  typeof TranslationSettingsDtoSchema
>;
export type LiveTranslationSegmentDto = z.infer<
  typeof LiveTranslationSegmentDtoSchema
>;
export type KnowledgeUnitDto = z.infer<typeof KnowledgeUnitDtoSchema>;
export type LectureMemoryDto = z.infer<typeof LectureMemoryDtoSchema>;
export type LectureNoteDto = z.infer<typeof LectureNoteDtoSchema>;
export type NoteGenerationStateDto = z.infer<typeof NoteGenerationStateDtoSchema>;
export type NoteSectionDto = z.infer<typeof NoteSectionDtoSchema>;
export type NoteItemDto = z.infer<typeof NoteItemDtoSchema>;
export type LiveNoteDto = z.infer<typeof LiveNoteDtoSchema>;
export type LiveNoteBulletDto = z.infer<typeof LiveNoteBulletDtoSchema>;
export type LectureAssistantModeDto = z.infer<
  typeof LectureAssistantModeDtoSchema
>;
export type LectureAnswerBasisDto = z.infer<typeof LectureAnswerBasisDtoSchema>;
export type TranscriptSelectionDto = z.infer<
  typeof TranscriptSelectionDtoSchema
>;
export type TranscriptSelectionIntentDto = z.infer<
  typeof TranscriptSelectionIntentDtoSchema
>;
export type LectureAssistantAnswerDto = z.infer<
  typeof LectureAssistantAnswerDtoSchema
>;
export type LectureAssistantQuestionDto = z.infer<
  typeof LectureAssistantQuestionDtoSchema
>;
export type LectureAnswerEvidenceDto = z.infer<typeof LectureAnswerEvidenceDtoSchema>;
export type LectureAnswerDto = z.infer<typeof LectureAnswerDtoSchema>;
export type LectureQuestionDto = z.infer<typeof LectureQuestionDtoSchema>;
export type ProfessorStyleProfileDto = z.infer<typeof ProfessorStyleProfileDtoSchema>;
export type AbsenceSummaryDto = z.infer<typeof AbsenceSummaryDtoSchema>;
export type AbsenceSpanDto = z.infer<typeof AbsenceSpanDtoSchema>;
export type MissedFlowRecoveryDto = z.infer<typeof MissedFlowRecoveryDtoSchema>;
export type MissedFlowRequestDto = z.infer<typeof MissedFlowRequestDtoSchema>;
export type UnderstandingBranchDto = z.infer<typeof UnderstandingBranchDtoSchema>;
export type UnderstandingRejoinPacketDto = z.infer<
  typeof UnderstandingRejoinPacketDtoSchema
>;
export type DeferredQuestionDto = z.infer<typeof DeferredQuestionDtoSchema>;
export type LectureActivityStateDto = z.infer<typeof LectureActivityStateDtoSchema>;
export type LectureEventDto = z.infer<typeof LectureEventDtoSchema>;
export type EmphasisEventDto = z.infer<typeof EmphasisEventDtoSchema>;
export type VerificationEventDto = z.infer<typeof VerificationEventDtoSchema>;
export type ReviewDto = z.infer<typeof ReviewDtoSchema>;
export type SessionStateDto = z.infer<typeof SessionStateDtoSchema>;
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;
export type RealtimeTokenDto = z.infer<typeof RealtimeTokenDtoSchema>;
export type TranscriptAction = z.infer<typeof TranscriptActionSchema>;
export type TranscriptResponseDto = z.infer<typeof TranscriptResponseDtoSchema>;
export type TranslationSettingsResponseDto = z.infer<
  typeof TranslationSettingsResponseDtoSchema
>;
export type AssistantRequestResponseDto = z.infer<
  typeof AssistantRequestResponseDtoSchema
>;
export type QuestionRequestResponseDto = z.infer<typeof QuestionRequestResponseDtoSchema>;
export type AbsenceRequestResponseDto = z.infer<typeof AbsenceRequestResponseDtoSchema>;
export type MissedFlowRequestResponseDto = z.infer<typeof MissedFlowRequestResponseDtoSchema>;
export type UnderstandingBranchResponseDto = z.infer<
  typeof UnderstandingBranchResponseDtoSchema
>;
export type DeferredQuestionResponseDto = z.infer<
  typeof DeferredQuestionResponseDtoSchema
>;
export type EndCancelResponseDto = z.infer<typeof EndCancelResponseDtoSchema>;
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
