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

export const MaterialKnowledgeItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourcePage: z.number().int().positive(),
  sourceText: z.string().min(1),
});

export const MaterialProcessSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  steps: z.array(z.object({
    order: z.number().int().positive(),
    text: z.string().min(1),
  })).min(1),
  sourcePage: z.number().int().positive(),
  sourceText: z.string().min(1),
});

export const MaterialTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  definitions: z.array(MaterialKnowledgeItemSchema),
  conditions: z.array(MaterialKnowledgeItemSchema),
  processes: z.array(MaterialProcessSchema),
  formulas: z.array(MaterialKnowledgeItemSchema),
  comparisons: z.array(MaterialKnowledgeItemSchema),
  examples: z.array(MaterialKnowledgeItemSchema),
  warnings: z.array(MaterialKnowledgeItemSchema),
  sourcePages: z.array(z.number().int().positive()),
});

export const MaterialTermSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  definition: z.string().nullable(),
  sourcePages: z.array(z.number().int().positive()),
});

export const MaterialKnowledgeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  outline: z.array(MaterialTopicSchema),
  terminology: z.array(MaterialTermSchema),
});

// Material Knowledge is the primary analysis. Slide Map remains as a UI and
// transcription-hint compatibility view and is not used to resolve lecture units.
export const MaterialAnalysisSchema = z.object({
  materialKnowledge: MaterialKnowledgeSchema,
  slideMap: SlideMapSchema,
});

export const SlideResolutionSchema = z.object({
  page: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  changed: z.boolean(),
  method: z.enum(["lexical", "llm_fallback", "kept_current"]),
});

export const SlideResolverOutputSchema = z.object({
  selectedPage: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  shouldSwitch: z.boolean(),
  reason: z.string().min(1),
});

export const TranscriptInputSchema = z.object({
  itemId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  source: z.enum(["realtime", "manual", "typed", "replay"]),
  receivedAt: z.string().datetime({ offset: true }),
  startedAtMs: z.number().int().nonnegative().nullable().optional(),
  endedAtMs: z.number().int().nonnegative().nullable().optional(),
});

export const TranscriptSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  source: z.enum(["realtime", "manual"]),
  receivedAt: z.string().datetime({ offset: true }),
  startedAtMs: z.number().int().nonnegative().nullable(),
  endedAtMs: z.number().int().nonnegative().nullable(),
  matchedSlidePages: z.array(z.number().int().positive()),
  matchedSlidePage: z.number().int().positive().nullable().optional(),
  slideConfidence: z.number().min(0).max(1).optional(),
});

export const TranslationTargetLanguageSchema = z.enum(["ko", "en"]);

export const TranslationSettingsSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: TranslationTargetLanguageSchema.nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const LiveTranslationSegmentSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  sourceText: z.string().min(1),
  translatedText: z.string().nullable(),
  targetLanguage: TranslationTargetLanguageSchema,
  status: z.enum(["translating", "complete", "failed"]),
  slidePage: z.number().int().positive().nullable(),
  settingsRevision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
});

export const KnowledgeUnitTypeSchema = z.enum([
  "definition",
  "condition",
  "process",
  "formula",
  "complexity",
  "comparison",
  "example",
  "warning",
  "conclusion",
]);
export const KnowledgeImportanceSchema = z.enum(["normal", "important", "exam"]);

export const KnowledgeUnitSchema = z.object({
  id: z.string().min(1),
  type: KnowledgeUnitTypeSchema,
  text: z.string().min(1),
  order: z.number().int().positive().nullable(),
  importance: KnowledgeImportanceSchema,
  sourceItemIds: z.array(z.string().min(1)).min(1),
  sourcePages: z.array(z.number().int().positive()),
  status: z.enum(["provisional", "confirmed"]),
});

export const PendingEmphasisSchema = z.object({
  id: z.string().min(1),
  importance: z.enum(["important", "exam"]),
  expectedCount: z.number().int().positive().nullable(),
  collectedKnowledgeUnitIds: z.array(z.string().min(1)),
  triggerItemIds: z.array(z.string().min(1)).min(1),
});

export const DeferredLectureStartSchema = z.object({
  workingTitle: z.string().nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string().min(1)),
  knowledgeUnits: z.array(KnowledgeUnitSchema),
});

export const OpenLectureUnitSchema = z.object({
  id: z.string().min(1),
  workingTitle: z.string().nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string().min(1)),
  provisionalKnowledge: z.array(KnowledgeUnitSchema),
  pendingEmphasis: PendingEmphasisSchema.nullable(),
  status: z.enum(["open", "closing_candidate"]),
  deferredStart: DeferredLectureStartSchema.nullable(),
});

export const CompletedLectureUnitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startedAtSequence: z.number().int().nonnegative(),
  endedAtSequence: z.number().int().nonnegative(),
  sourceItemIds: z.array(z.string().min(1)).min(1),
  knowledgeUnits: z.array(KnowledgeUnitSchema).min(1),
  noteId: z.string().nullable(),
});

export const LectureMemorySchema = z.object({
  revision: z.number().int().nonnegative(),
  currentUnit: OpenLectureUnitSchema.nullable(),
  completedUnits: z.array(CompletedLectureUnitSchema),
  recentTopicSummary: z.string(),
});

export const LectureStatePatchSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  activity: z.enum([
    "instruction",
    "example",
    "class_question",
    "class_administration",
    "off_topic",
    "break",
  ]),
  unitDecision: z.enum([
    "continue",
    "close_candidate",
    "close_and_start",
    "close_and_wait",
  ]),
  workingUnitTitle: z.string().nullable(),
  newKnowledgeUnits: z.array(z.object({
    type: KnowledgeUnitTypeSchema,
    text: z.string().min(1),
    order: z.number().int().positive().nullable(),
    importance: KnowledgeImportanceSchema,
    sourceItemIds: z.array(z.string().min(1)).min(1),
    sourcePages: z.array(z.number().int().positive()),
  })),
  emphasisUpdates: z.array(z.object({
    targetSourceItemIds: z.array(z.string().min(1)).min(1),
    targetKnowledgeUnitIds: z.array(z.string().min(1)),
    importance: z.enum(["important", "exam"]),
    reason: z.string().min(1),
  })),
  pendingEmphasis: z.object({
    importance: z.enum(["important", "exam"]),
    expectedCount: z.number().int().positive().nullable(),
    triggerItemIds: z.array(z.string().min(1)).min(1),
  }).nullable(),
  cancelPendingEmphasis: z.boolean(),
  unitSummary: z.string().nullable(),
});

export const NoteItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  importance: KnowledgeImportanceSchema,
  sourceItemIds: z.array(z.string().min(1)),
  sourcePages: z.array(z.number().int().positive()),
}).refine(
  (item) => item.sourceItemIds.length > 0 || item.sourcePages.length > 0,
  { message: "Every note item needs transcript or material evidence" },
);

export const NoteSectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  layout: z.enum(["bullets", "steps"]),
  items: z.array(NoteItemSchema).min(1),
});

export const LectureNoteSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  status: z.enum(["live", "final"]).default("live"),
  title: z.string().min(1),
  sections: z.array(NoteSectionSchema).min(1),
  sourceItemIds: z.array(z.string().min(1)),
  sourcePages: z.array(z.number().int().positive()),
  processedThroughSequence: z.number().int().nonnegative().default(0),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const NoteCompositionSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  title: z.string().min(1),
  sections: z.array(z.object({
    heading: z.string().min(1),
    layout: z.enum(["bullets", "steps"]),
    items: z.array(z.object({
      text: z.string().min(1),
      importance: KnowledgeImportanceSchema,
      sourceItemIds: z.array(z.string().min(1)),
      sourcePages: z.array(z.number().int().positive()),
    })).min(1),
  })).min(1),
});

export const NoteReviewSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  publishable: z.boolean(),
  unsupportedItemIds: z.array(z.string()),
  missingKnowledgeUnitIds: z.array(z.string()),
  duplicateGroups: z.array(z.array(z.string()).min(2)),
  importanceCorrections: z.array(z.object({
    itemId: z.string().min(1),
    importance: KnowledgeImportanceSchema,
  })),
  revisionInstructions: z.array(z.string().min(1)),
});

export const NoteGenerationTriggerSchema = z.enum([
  "scheduled",
  "manual",
  "final",
]);

export const NoteGenerationStatusSchema = z.enum([
  "idle",
  "queued",
  "generating",
  "reviewing",
  "completed",
  "failed",
]);

export const NoteGenerationStateSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int().positive(),
  status: NoteGenerationStatusSchema,
  revision: z.number().int().nonnegative(),
  lastProcessedSequence: z.number().int().nonnegative(),
  processedItemIds: z.array(z.string().min(1)),
  lastGeneratedAt: z.string().datetime({ offset: true }).nullable(),
  nextScheduledAt: z.string().datetime({ offset: true }).nullable(),
  activeJobId: z.string().nullable(),
  activeTrigger: NoteGenerationTriggerSchema.nullable(),
  pendingManualRequest: z.boolean(),
  lastError: z.string().nullable(),
  currentNote: LectureNoteSchema.nullable(),
  finalNote: LectureNoteSchema.nullable(),
});

export const LiveNoteBulletKindSchema = z.enum([
  "concept",
  "definition",
  "process",
  "example",
  "comparison",
  "caution",
  "formula",
]);

export const LiveNoteBulletSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: LiveNoteBulletKindSchema,
  emphasized: z.boolean(),
  sourceSequences: z.array(z.number().int().nonnegative()),
});

export const LiveNoteSchema = z.object({
  id: z.string().min(1),
  slidePage: z.number().int().positive().nullable(),
  title: z.string(),
  summary: z.string(),
  bullets: z.array(LiveNoteBulletSchema).max(8),
  keyTerms: z.array(z.string()),
  lastProcessedSequence: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const LiveNoteSynthesisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  bullets: z.array(
    z.object({
      text: z.string().min(1),
      kind: LiveNoteBulletKindSchema,
      sourceSequences: z.array(z.number().int().nonnegative()),
    }),
  ).max(8),
  keyTerms: z.array(z.string()),
});

export const LectureAssistantModeSchema = z.enum([
  "question",
  "explain_selection",
]);

export const LectureAnswerBasisSchema = z.enum([
  "lecture_only",
  "lecture_plus_general_knowledge",
  "general_knowledge",
]);

export const TranscriptSelectionIntentSchema = z.enum([
  "explain",
  "simplify",
  "example",
  "define_terms",
]);

export const TranscriptSelectionContextSchema = z.object({
  selectedText: z.string().trim().min(4).max(12_000),
  sourceItemIds: z.array(z.string().min(1)).min(1),
  startSequence: z.number().int().nonnegative(),
  endSequence: z.number().int().nonnegative(),
  // A selection always retains its original transcript identity. Translation
  // selections additionally carry the completed translation ids that rendered
  // the visible text, so the server can validate that the user did not submit
  // arbitrary text as a caption selection.
  kind: z.enum(["original", "translation"]).default("original"),
  targetLanguage: TranslationTargetLanguageSchema.nullable().default(null),
  translationIds: z.array(z.string().min(1)).default([]),
  // Optional for backward compatibility with selections stored before the
  // expanded drag menu was introduced. Missing values mean "explain".
  intent: TranscriptSelectionIntentSchema.optional(),
}).refine(
  (selection) => selection.startSequence <= selection.endSequence,
  { message: "Selection startSequence must not exceed endSequence" },
);

export const LectureAssistantAnswerSchema = z.object({
  title: z.string().trim().min(1),
  directAnswer: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  keyPoints: z.array(z.string().trim().min(1)),
  example: z.string().trim().min(1).nullable(),
  basis: LectureAnswerBasisSchema,
  referencedItemIds: z.array(z.string().min(1)),
});

export const StoredLectureAssistantAnswerSchema =
  LectureAssistantAnswerSchema.extend({
    answeredAt: z.string().datetime({ offset: true }),
  });

export const LectureAssistantQuestionSchema = z.object({
  id: z.string().min(1),
  mode: LectureAssistantModeSchema,
  question: z.string().trim().min(1),
  selection: TranscriptSelectionContextSchema.nullable(),
  snapshotSequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  status: z.enum(["queued", "answering", "answered", "failed"]),
  answer: StoredLectureAssistantAnswerSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const LectureAssistantRequestInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("question"),
    question: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    mode: z.literal("explain_selection"),
    selectedText: TranscriptSelectionContextSchema.shape.selectedText,
    sourceItemIds: TranscriptSelectionContextSchema.shape.sourceItemIds,
    startSequence: TranscriptSelectionContextSchema.shape.startSequence,
    endSequence: TranscriptSelectionContextSchema.shape.endSequence,
    kind: TranscriptSelectionContextSchema.shape.kind,
    targetLanguage: TranscriptSelectionContextSchema.shape.targetLanguage,
    translationIds: TranscriptSelectionContextSchema.shape.translationIds,
    intent: TranscriptSelectionContextSchema.shape.intent,
  }).refine(
    (selection) => selection.startSequence <= selection.endSequence,
    { message: "Selection startSequence must not exceed endSequence" },
  ),
]);

export const LectureAnswerEvidenceSchema = z.object({
  type: z.enum([
    "material",
    "transcript",
    "structured_note",
    "open_unit",
  ]),
  sourcePage: z.number().int().positive().nullable(),
  sourceItemIds: z.array(z.string().min(1)),
  noteId: z.string().min(1).nullable(),
  label: z.string().min(1),
  excerpt: z.string().min(1),
});

export const LectureAnswerSchema = z.object({
  text: z.string().min(1),
  shortAnswer: z.string().min(1),
  keyPoints: z.array(z.string().min(1)),
  evidence: z.array(LectureAnswerEvidenceSchema),
  basedOn: z.enum([
    "material_and_transcript",
    "material_only",
    "transcript_only",
    "notes_and_transcript",
  ]),
  styleProfileRevision: z.number().int().positive().nullable(),
  answeredAt: z.string().datetime({ offset: true }),
});

export const LectureQuestionSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  question: z.string().trim().min(1).max(4_000),
  selection: TranscriptSelectionContextSchema.nullable().default(null),
  // When live translation is active, answers should be useful in the same
  // language as the caption the student is reading. Null preserves the
  // original question-only behaviour.
  answerLanguage: TranslationTargetLanguageSchema.nullable().default(null),
  askedAt: z.string().datetime({ offset: true }),
  askedAtSequence: z.number().int().nonnegative().nullable(),
  lectureRevision: z.number().int().nonnegative(),
  status: z.enum([
    "queued",
    "answering",
    "answered",
    "insufficient_context",
    "failed",
  ]),
  answer: LectureAnswerSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const LectureQuestionInputSchema = z.object({
  question: z.string().trim().min(1).max(4_000).optional(),
  selection: TranscriptSelectionContextSchema.optional(),
}).superRefine((input, context) => {
  if (Boolean(input.question) === Boolean(input.selection)) {
    context.addIssue({
      code: "custom",
      message: "Provide either a question or a transcript selection",
    });
  }
});

export const LectureAnswerDraftSchema = z.object({
  answerable: z.boolean(),
  shortAnswer: z.string(),
  explanation: z.string(),
  keyPoints: z.array(z.string()),
  evidenceRefs: z.array(z.object({
    type: z.enum([
      "material",
      "transcript",
      "structured_note",
      "open_unit",
    ]),
    sourcePage: z.number().int().positive().nullable(),
    sourceItemIds: z.array(z.string()),
    noteId: z.string().nullable(),
    reason: z.string(),
  })),
  missingContext: z.array(z.string()),
});

export const LectureAnswerReviewSchema = z.object({
  publishable: z.boolean(),
  unsupportedEvidenceIndexes: z.array(z.number().int().nonnegative()),
  revisionInstructions: z.array(z.string()),
  reason: z.string(),
});

export const ProfessorStyleProfileSchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
  formality: z.enum(["formal", "casual", "mixed"]),
  explanationDensity: z.enum(["brief", "balanced", "detailed"]),
  sentenceLength: z.enum(["short", "mixed", "long"]),
  usesStepByStepExplanation: z.boolean(),
  usesAnalogies: z.boolean(),
  usesExamplesFrequently: z.boolean(),
  usesQuestionsRhetorically: z.boolean(),
  recurringPhrases: z.array(z.string()).max(8),
  emphasisPatterns: z.array(z.string()).max(8),
  transitionPatterns: z.array(z.string()).max(8),
  styleSummary: z.string().min(1),
  sourceItemIds: z.array(z.string().min(1)),
});

export const ProfessorStyleDraftSchema = ProfessorStyleProfileSchema.omit({
  revision: true,
  updatedAt: true,
  sourceItemIds: true,
});

export const AbsenceSummarySectionSchema = z.object({
  title: z.string().min(1),
  explanation: z.string().min(1),
  keyPoints: z.array(z.string().min(1)),
});

export const AbsenceSummarySchema = z.object({
  overview: z.string().min(1),
  detailedSections: z.array(AbsenceSummarySectionSchema),
  importantPoints: z.array(z.string().min(1)),
  currentLecturePosition: z.string().min(1),
  suggestedReviewQuestions: z.array(z.string().min(1)),
  sourceItemIds: z.array(z.string().min(1)),
  sourceNoteIds: z.array(z.string().min(1)),
  sourcePages: z.array(z.number().int().positive()),
  generatedAt: z.string().datetime({ offset: true }),
  fallback: z.boolean().default(false),
});

export const AbsenceSummaryDraftSchema = AbsenceSummarySchema.omit({
  generatedAt: true,
  fallback: true,
});

export const AbsenceSummaryReviewSchema = z.object({
  publishable: z.boolean(),
  revisionInstructions: z.array(z.string()),
  reason: z.string(),
});

export const AbsenceSpanSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["active", "summarizing", "completed", "failed"]),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  startedAtSequence: z.number().int().nonnegative(),
  endedAtSequence: z.number().int().nonnegative().nullable(),
  startedAtRevision: z.number().int().nonnegative(),
  endedAtRevision: z.number().int().nonnegative().nullable(),
  summary: AbsenceSummarySchema.nullable(),
  errorMessage: z.string().nullable(),
});

// A recovery card is intentionally narrower than a general Q&A answer: it
// reconstructs the local lecture transition around the instant the learner
// reported losing the thread.
export const MissedFlowRecoverySchema = z.object({
  whatCameBefore: z.string().min(1),
  whyThisCameNext: z.string().min(1),
  requiredIdea: z.string().min(1),
  resumeWith: z.string().min(1),
  sourceItemIds: z.array(z.string().min(1)),
  sourcePages: z.array(z.number().int().positive()),
  generatedAt: z.string().datetime({ offset: true }),
  fallback: z.boolean().default(false),
});

export const MissedFlowRecoveryDraftSchema = MissedFlowRecoverySchema.omit({
  generatedAt: true,
  fallback: true,
});

export const MissedFlowRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["capturing", "generating", "completed", "failed"]),
  clickedAt: z.string().datetime({ offset: true }),
  captureEndsAt: z.string().datetime({ offset: true }),
  clickedAtSequence: z.number().int().nonnegative(),
  capturedThroughSequence: z.number().int().nonnegative().nullable(),
  recovery: MissedFlowRecoverySchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const UnderstandingBranchMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  answer: StoredLectureAssistantAnswerSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export const UnderstandingQuickRejoinSchema = z.object({
  mustKnowNow: z.array(z.string().trim().min(1).max(160)).max(3),
  currentTopic: z.string().trim().min(1).max(200),
  bridgeSentence: z.string().trim().min(1).max(240),
  listenForNext: z.string().trim().min(1).max(200),
});

export const UnderstandingDetailedCatchUpSchema = z.object({
  branchSummary: z.string().trim().min(1),
  missedLectureSummary: z.string().trim().min(1),
  keyPoints: z.array(z.string().trim().min(1)),
});

export const UnderstandingRejoinPacketSchema = z.object({
  quickRejoin: UnderstandingQuickRejoinSchema,
  detailedCatchUp: UnderstandingDetailedCatchUpSchema,
  missedItemIds: z.array(z.string().min(1)),
  // Legacy fields remain in the stored/API packet so completed records and
  // older clients keep working while the UI moves to the two-layer shape.
  understoodContent: z.array(z.string().min(1)),
  lectureProgress: z.array(z.string().min(1)),
  currentLecturePosition: z.string().min(1),
  connection: z.string().min(1),
  listenFor: z.array(z.string().min(1)),
  sourceItemIds: z.array(z.string().min(1)),
  rawTranscript: z.array(z.object({
    itemId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    text: z.string().min(1),
    receivedAt: z.string().datetime({ offset: true }),
  })),
  currentNoteSnapshot: LectureNoteSchema.nullable(),
  generatedAt: z.string().datetime({ offset: true }),
  fallback: z.boolean().default(false),
});

export const UnderstandingRejoinDraftSchema = UnderstandingRejoinPacketSchema.pick({
  quickRejoin: true,
  detailedCatchUp: true,
  sourceItemIds: true,
});

export const UnderstandingBranchSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.literal("immediate_understanding"),
  startSource: z.enum(["selection", "current_point", "deferred_question"]),
  focusText: z.string().trim().min(1),
  selection: TranscriptSelectionContextSchema.nullable(),
  startedAt: z.string().datetime({ offset: true }),
  startedAtSequence: z.number().int().nonnegative(),
  startedAtRevision: z.number().int().nonnegative(),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  endedAtSequence: z.number().int().nonnegative().nullable(),
  status: z.enum(["active", "rejoining", "completed", "failed"]),
  explanationStatus: z.enum(["answering", "answered", "failed"]),
  messageStatus: z.enum(["idle", "answering"]),
  messages: z.array(UnderstandingBranchMessageSchema),
  rejoinPacket: UnderstandingRejoinPacketSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export const UnderstandingBranchStartInputSchema = z.object({
  selection: TranscriptSelectionContextSchema.optional(),
});

export const UnderstandingBranchMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
});

export const DeferredQuestionStatusSchema = z.enum([
  "pending",
  "explained_by_lecture",
  "ai_explanation_available",
  "resolved",
  "failed",
]);

export const DeferredQuestionSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  focusText: z.string().trim().min(1),
  question: z.string().trim().min(1).max(4_000),
  selection: TranscriptSelectionContextSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  startedAtSequence: z.number().int().nonnegative(),
  startedAtRevision: z.number().int().nonnegative(),
  status: DeferredQuestionStatusSchema,
  checkStatus: z.enum(["idle", "checking"]),
  lastCheckedThroughSequence: z.number().int().nonnegative(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  checkCount: z.number().int().nonnegative(),
  lectureExplanation: z.string().nullable(),
  relatedItemIds: z.array(z.string().min(1)),
  relatedSequences: z.array(z.number().int().nonnegative()),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  errorMessage: z.string().nullable(),
});

export const DeferredQuestionInputSchema = z.object({
  selection: TranscriptSelectionContextSchema.optional(),
  question: z.string().trim().min(1).max(4_000).optional(),
});

export const DeferredQuestionDecisionSchema = z.object({
  explained: z.boolean(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  relatedItemIds: z.array(z.string()),
});

export const DeferredQuestionUpdateSchema = z.object({
  action: z.enum(["resolve", "keep_waiting", "still_confused"]),
});

export const LectureActivitySchema = z.enum([
  "instruction",
  "example",
  "class_question",
  "class_administration",
  "off_topic",
  "break",
  "silence",
  "ending",
]);

export const EndingCandidateSchema = z.object({
  kind: z.enum(["explicit", "inactivity"]),
  detectedAt: z.string().datetime({ offset: true }),
  sourceItemIds: z.array(z.string().min(1)),
  reason: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

export const InactivityCandidateSchema = z.object({
  detectedAt: z.string().datetime({ offset: true }),
  lastMeaningfulInstructionAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const LectureActivityStateSchema = z.object({
  currentActivity: LectureActivitySchema,
  monitoringStartedAt: z.string().datetime({ offset: true }).nullable(),
  lastSpeechAt: z.string().datetime({ offset: true }).nullable(),
  lastMeaningfulInstructionAt: z.string().datetime({ offset: true }).nullable(),
  endingCandidate: EndingCandidateSchema.nullable(),
  inactivityCandidate: InactivityCandidateSchema.nullable(),
});

export const WebSearchSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  hostname: z.string().min(1).optional(),
  description: z.string(),
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

export const EmphasisKindSchema = z.enum([
  "exam",
  "must_remember",
  "definition",
  "caution",
  "contrast",
  "repeated_focus",
]);

export const EmphasisEvidenceTypeSchema = z.enum([
  "explicit_phrase",
  "contextual_reference",
  "repetition",
  "correction",
  "contrast",
]);

export const EmphasisEventSchema = z.object({
  id: z.string(),
  type: z.literal("emphasis"),
  status: z.literal("complete"),
  quote: z.string(),
  concept: z.string(),
  resolvedConcept: z.string(),
  emphasisKind: EmphasisKindSchema,
  evidenceType: EmphasisEvidenceTypeSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  slidePage: z.number().int().positive().nullable(),
  sourceSequences: z.array(z.number().int().nonnegative()),
  createdAt: z.string(),
});

export const VerificationEventSchema = z.object({
  id: z.string(),
  type: z.literal("verification"),
  lectureClaim: z.string(),
  slideClaim: z.string(),
  slidePage: z.number().int().positive().nullable(),
  query: z.string(),
  status: z.enum(["searching", "complete", "failed"]),
  sources: z.array(WebSearchSourceSchema).max(3),
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
  category: z.enum(["agent_stream", "tool_call", "tool_result", "system", "error"]),
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
  resolvedConcept: z.string().min(1),
  emphasisKind: EmphasisKindSchema,
  evidenceType: EmphasisEvidenceTypeSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  slidePage: z.number().int().positive().nullable(),
  sourceSequences: z.array(z.number().int().nonnegative()).min(1),
});

export const VerifyClaimArgsSchema = z.object({
  lectureClaim: z.string().min(1),
  slideClaim: z.string().min(1),
  slidePage: z.number().int().positive().nullable(),
  query: z.string().min(1),
});

export const FinishLessonArgsSchema = z.object({
  closingQuote: z.string().min(1),
});

export type SlideMap = z.infer<typeof SlideMapSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type MaterialKnowledge = z.infer<typeof MaterialKnowledgeSchema>;
export type MaterialTopic = z.infer<typeof MaterialTopicSchema>;
export type MaterialKnowledgeItem = z.infer<typeof MaterialKnowledgeItemSchema>;
export type MaterialProcess = z.infer<typeof MaterialProcessSchema>;
export type MaterialTerm = z.infer<typeof MaterialTermSchema>;
export type MaterialAnalysis = z.infer<typeof MaterialAnalysisSchema>;
export type SlideResolution = z.infer<typeof SlideResolutionSchema>;
export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type TranslationTargetLanguage = z.infer<
  typeof TranslationTargetLanguageSchema
>;
export type TranslationSettings = z.infer<typeof TranslationSettingsSchema>;
export type LiveTranslationSegment = z.infer<
  typeof LiveTranslationSegmentSchema
>;
export type KnowledgeUnit = z.infer<typeof KnowledgeUnitSchema>;
export type PendingEmphasis = z.infer<typeof PendingEmphasisSchema>;
export type OpenLectureUnit = z.infer<typeof OpenLectureUnitSchema>;
export type CompletedLectureUnit = z.infer<typeof CompletedLectureUnitSchema>;
export type LectureMemory = z.infer<typeof LectureMemorySchema>;
export type LectureStatePatch = z.infer<typeof LectureStatePatchSchema>;
export type LectureNote = z.infer<typeof LectureNoteSchema>;
export type NoteComposition = z.infer<typeof NoteCompositionSchema>;
export type NoteReview = z.infer<typeof NoteReviewSchema>;
export type NoteGenerationTrigger = z.infer<typeof NoteGenerationTriggerSchema>;
export type NoteGenerationStatus = z.infer<typeof NoteGenerationStatusSchema>;
export type NoteGenerationState = z.infer<typeof NoteGenerationStateSchema>;
export type LiveNote = z.infer<typeof LiveNoteSchema>;
export type LiveNoteBullet = z.infer<typeof LiveNoteBulletSchema>;
export type LectureAssistantMode = z.infer<typeof LectureAssistantModeSchema>;
export type LectureAnswerBasis = z.infer<typeof LectureAnswerBasisSchema>;
export type TranscriptSelectionContext = z.infer<
  typeof TranscriptSelectionContextSchema
>;
export type TranscriptSelectionIntent = z.infer<
  typeof TranscriptSelectionIntentSchema
>;
export type LectureAssistantModelAnswer = z.infer<
  typeof LectureAssistantAnswerSchema
>;
export type LectureAssistantAnswer = z.infer<
  typeof StoredLectureAssistantAnswerSchema
>;
export type LectureAssistantQuestion = z.infer<
  typeof LectureAssistantQuestionSchema
>;
export type LectureAssistantRequestInput = z.infer<
  typeof LectureAssistantRequestInputSchema
>;
export type LectureAnswerEvidence = z.infer<typeof LectureAnswerEvidenceSchema>;
export type LectureAnswer = z.infer<typeof LectureAnswerSchema>;
export type LectureQuestion = z.infer<typeof LectureQuestionSchema>;
export type LectureQuestionInput = z.infer<typeof LectureQuestionInputSchema>;
export type LectureAnswerDraft = z.infer<typeof LectureAnswerDraftSchema>;
export type LectureAnswerReview = z.infer<typeof LectureAnswerReviewSchema>;
export type ProfessorStyleProfile = z.infer<typeof ProfessorStyleProfileSchema>;
export type ProfessorStyleDraft = z.infer<typeof ProfessorStyleDraftSchema>;
export type AbsenceSummarySection = z.infer<typeof AbsenceSummarySectionSchema>;
export type AbsenceSummary = z.infer<typeof AbsenceSummarySchema>;
export type AbsenceSummaryDraft = z.infer<typeof AbsenceSummaryDraftSchema>;
export type AbsenceSummaryReview = z.infer<typeof AbsenceSummaryReviewSchema>;
export type AbsenceSpan = z.infer<typeof AbsenceSpanSchema>;
export type MissedFlowRecovery = z.infer<typeof MissedFlowRecoverySchema>;
export type MissedFlowRecoveryDraft = z.infer<typeof MissedFlowRecoveryDraftSchema>;
export type MissedFlowRequest = z.infer<typeof MissedFlowRequestSchema>;
export type UnderstandingBranchMessage = z.infer<
  typeof UnderstandingBranchMessageSchema
>;
export type UnderstandingRejoinPacket = z.infer<
  typeof UnderstandingRejoinPacketSchema
>;
export type UnderstandingRejoinDraft = z.infer<
  typeof UnderstandingRejoinDraftSchema
>;
export type UnderstandingBranch = z.infer<typeof UnderstandingBranchSchema>;
export type UnderstandingBranchStartInput = z.infer<
  typeof UnderstandingBranchStartInputSchema
>;
export type DeferredQuestion = z.infer<typeof DeferredQuestionSchema>;
export type DeferredQuestionDecision = z.infer<
  typeof DeferredQuestionDecisionSchema
>;
export type LectureActivity = z.infer<typeof LectureActivitySchema>;
export type EndingCandidate = z.infer<typeof EndingCandidateSchema>;
export type InactivityCandidate = z.infer<typeof InactivityCandidateSchema>;
export type LectureActivityState = z.infer<typeof LectureActivityStateSchema>;
export type LectureEvent = z.infer<typeof LectureEventSchema>;
export type EmphasisEvent = z.infer<typeof EmphasisEventSchema>;
export type VerificationEvent = z.infer<typeof VerificationEventSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type RawLog = z.infer<typeof RawLogSchema>;

export type SessionStatus =
  | "preparing"
  | "ready"
  | "listening"
  | "ending_candidate"
  | "inactivity_candidate"
  | "finalizing"
  | "ended"
  | "error";

export interface LectureSession {
  id: string;
  version: number;
  status: SessionStatus;
  instruction: string;
  language: string;
  materialKnowledge: MaterialKnowledge;
  slideMap: SlideMap;
  currentSlidePage: number | null;
  slideResolution: SlideResolution | null;
  pendingSlideCandidate: { page: number; hits: number } | null;
  transcripts: Transcript[];
  translationSettings: TranslationSettings;
  translations: LiveTranslationSegment[];
  translationChain: Promise<void>;
  processedTranslationKeys: Set<string>;
  lectureMemory: LectureMemory;
  lectureNotes: LectureNote[];
  noteGeneratingUnitIds: Set<string>;
  noteGeneration: NoteGenerationState;
  noteGenerationChain: Promise<void>;
  noteGenerationTimer: ReturnType<typeof setTimeout> | null;
  noteGenerationEpoch: number;
  finalizationChain: Promise<void>;
  lectureRevision: number;
  questions: LectureQuestion[];
  questionChain: Promise<void>;
  questionEpoch: number;
  professorStyleProfile: ProfessorStyleProfile | null;
  professorStyleChain: Promise<void>;
  professorStyleEpoch: number;
  professorStyleLastProcessedSequence: number;
  professorStyleQueuedThroughSequence: number;
  absenceSpans: AbsenceSpan[];
  absenceSummaryChain: Promise<void>;
  absenceEpoch: number;
  missedFlowRequests: MissedFlowRequest[];
  missedFlowChain: Promise<void>;
  missedFlowEpoch: number;
  understandingBranches: UnderstandingBranch[];
  understandingBranchChain: Promise<void>;
  understandingBranchEpoch: number;
  deferredQuestions: DeferredQuestion[];
  deferredQuestionChain: Promise<void>;
  deferredQuestionEpoch: number;
  activityState: LectureActivityState;
  activityTimer: ReturnType<typeof setTimeout> | null;
  activityEpoch: number;
  assistantRequests: LectureAssistantQuestion[];
  assistantChain: Promise<void>;
  assistantEpoch: number;
  liveNotes: LiveNote[];
  events: LectureEvent[];
  review: Review | null;
  rawLogs: RawLog[];
  createdAt: string;
  updatedAt: string;
  processedItemIds: Set<string>;
  eventKeys: Set<string>;
  analysisChain: Promise<void>;
  interpreterChain: Promise<void>;
  noteCompositionChain: Promise<void>;
  noteUpdateChain: Promise<void>;
  pendingNoteSequences: number[];
  lastNoteUpdateAt: number;
  noteUpdateTimer: ReturnType<typeof setTimeout> | null;
}

export type AgentActionName =
  | "none"
  | "mark_emphasis"
  | "verify_claim_with_web_search"
  | "finish_lesson";

export interface ActionControl {
  actionTaken: boolean;
  action: AgentActionName;
}
