import { randomUUID } from "node:crypto";
import { appendRawLog } from "../logs/raw-log";
import {
  LectureMemorySchema,
  type CompletedLectureUnit,
  type KnowledgeUnit,
  type LectureSession,
  type LectureStatePatch,
  type OpenLectureUnit,
  type PendingEmphasis,
  type Transcript,
} from "../schemas";
import { touchSession } from "../session-store";
import type { LectureInterpreterContext } from "./build-lecture-context";
import {
  deduplicateKnowledgeUnits,
  strongerImportance,
} from "./deduplicate-knowledge-units";

export interface LecturePatchApplyResult {
  applied: boolean;
  finalizedUnit: CompletedLectureUnit | null;
  reason: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isNegativeEmphasis(text: string): boolean {
  return /(중요하지\s*않|시험(?:에)?\s*(?:나오지\s*않|안\s*나오)|외울\s*필요\s*(?:가\s*)?없|not\s+important|not\s+on\s+the\s+exam|do\s+not\s+memorize)/iu.test(text);
}

function makeKnowledgeUnits(
  patch: LectureStatePatch,
  context: LectureInterpreterContext,
): KnowledgeUnit[] {
  if (patch.activity !== "instruction" && patch.activity !== "example") return [];
  const allowedItems = new Set(context.allowedSourceItemIds);
  const allowedPages = new Set(context.allowedSourcePages);
  return patch.newKnowledgeUnits.flatMap((knowledge): KnowledgeUnit[] => {
    if (/^(?:(?:이것|그것|저것)(?:이|은|는|을|를|가)?|이게|그게|이는|(?:this|that|it)\b)/iu.test(knowledge.text.trim())) {
      return [];
    }
    const sourceItemIds = unique(
      knowledge.sourceItemIds.filter((itemId) => allowedItems.has(itemId)),
    );
    if (sourceItemIds.length === 0) return [];
    return [{
      id: randomUUID(),
      type: knowledge.type,
      text: knowledge.text.trim(),
      order: knowledge.order,
      importance: knowledge.importance,
      sourceItemIds,
      sourcePages: Array.from(new Set(
        knowledge.sourcePages.filter((page) => allowedPages.has(page)),
      )).sort((left, right) => left - right),
      status: "provisional",
    }];
  });
}

function createOpenUnit(
  transcript: Transcript,
  workingTitle: string | null,
  knowledgeUnits: KnowledgeUnit[],
  sourceItemIds: string[] = [transcript.itemId],
): OpenLectureUnit {
  return {
    id: randomUUID(),
    workingTitle,
    startedAtSequence: transcript.sequence,
    lastSequence: transcript.sequence,
    sourceItemIds: unique(sourceItemIds),
    provisionalKnowledge: deduplicateKnowledgeUnits(knowledgeUnits),
    pendingEmphasis: null,
    status: "open",
    deferredStart: null,
  };
}

function applyPendingEmphasis(
  unit: OpenLectureUnit,
  newUnits: KnowledgeUnit[],
): PendingEmphasis | null {
  const pending = unit.pendingEmphasis;
  if (!pending || newUnits.length === 0) return pending;
  const remaining = pending.expectedCount === null
    ? newUnits.length
    : Math.max(0, pending.expectedCount - pending.collectedKnowledgeUnitIds.length);
  const selected = newUnits.slice(0, remaining);
  for (const knowledge of selected) {
    knowledge.importance = strongerImportance(
      knowledge.importance,
      pending.importance,
    );
  }
  const collectedKnowledgeUnitIds = unique([
    ...pending.collectedKnowledgeUnitIds,
    ...selected.map((knowledge) => knowledge.id),
  ]);
  if (
    pending.expectedCount !== null &&
    collectedKnowledgeUnitIds.length >= pending.expectedCount
  ) return null;
  // An unspecified forward reference applies to the next meaningful group once.
  if (pending.expectedCount === null && selected.length > 0) return null;
  return { ...pending, collectedKnowledgeUnitIds };
}

function applyBackwardEmphasis(
  units: KnowledgeUnit[],
  patch: LectureStatePatch,
  allowEmphasis: boolean,
): void {
  if (!allowEmphasis) return;
  for (const update of patch.emphasisUpdates) {
    const targetIds = new Set(update.targetSourceItemIds);
    const targetKnowledgeIds = new Set(update.targetKnowledgeUnitIds);
    for (const knowledge of units) {
      if (
        (targetKnowledgeIds.size > 0 && targetKnowledgeIds.has(knowledge.id)) ||
        (targetKnowledgeIds.size === 0 &&
          knowledge.sourceItemIds.some((itemId) => targetIds.has(itemId)))
      ) {
        knowledge.importance = strongerImportance(
          knowledge.importance,
          update.importance,
        );
      }
    }
  }
}

function mergeIntoCurrent(
  unit: OpenLectureUnit,
  transcript: Transcript,
  knowledgeUnits: KnowledgeUnit[],
  includeTranscript: boolean,
): void {
  const existingIds = new Set(unit.provisionalKnowledge.map((knowledge) => knowledge.id));
  const mergedKnowledge = deduplicateKnowledgeUnits([
    ...unit.provisionalKnowledge,
    ...knowledgeUnits,
  ]);
  const genuinelyNew = mergedKnowledge.filter((knowledge) => !existingIds.has(knowledge.id));
  unit.pendingEmphasis = applyPendingEmphasis(unit, genuinelyNew);
  unit.provisionalKnowledge = mergedKnowledge;
  unit.lastSequence = Math.max(unit.lastSequence, transcript.sequence);
  if (includeTranscript) {
    unit.sourceItemIds = unique([...unit.sourceItemIds, transcript.itemId]);
  }
}

function finalizeCurrentUnit(
  session: LectureSession,
): CompletedLectureUnit | null {
  const current = session.lectureMemory.currentUnit;
  if (!current || current.provisionalKnowledge.length === 0) {
    session.lectureMemory.currentUnit = null;
    return null;
  }
  const knowledgeUnits = current.provisionalKnowledge.map((knowledge) => ({
    ...knowledge,
    status: "confirmed" as const,
  }));
  const completed: CompletedLectureUnit = {
    id: current.id,
    title: current.workingTitle?.trim() || "Lecture Unit",
    startedAtSequence: current.startedAtSequence,
    endedAtSequence: current.lastSequence,
    sourceItemIds: unique([
      ...current.sourceItemIds,
      ...knowledgeUnits.flatMap((knowledge) => knowledge.sourceItemIds),
    ]),
    knowledgeUnits,
    noteId: null,
  };
  session.lectureMemory.completedUnits.push(completed);
  session.lectureMemory.currentUnit = null;
  return completed;
}

export function applyLectureStatePatch(
  session: LectureSession,
  patch: LectureStatePatch,
  context: LectureInterpreterContext,
): LecturePatchApplyResult {
  if (patch.baseRevision !== session.lectureMemory.revision) {
    appendRawLog(session, "system", "lecture_patch_rejected", {
      sessionId: session.id,
      baseRevision: patch.baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: [context.newTranscript.itemId],
      unitId: session.lectureMemory.currentUnit?.id ?? null,
      durationMs: 0,
      reason: "stale_revision",
    });
    return { applied: false, finalizedUnit: null, reason: "stale_revision" };
  }

  const transcript = context.newTranscript;
  const allowEmphasis = !isNegativeEmphasis(transcript.text);
  const newKnowledgeUnits = makeKnowledgeUnits(patch, context);
  let current = session.lectureMemory.currentUnit;
  let finalizedUnit: CompletedLectureUnit | null = null;
  if (current && patch.cancelPendingEmphasis) current.pendingEmphasis = null;

  if (!current) {
    if (newKnowledgeUnits.length > 0) {
      current = createOpenUnit(
        transcript,
        patch.workingUnitTitle,
        newKnowledgeUnits,
      );
      session.lectureMemory.currentUnit = current;
    }
  } else if (current.status === "open") {
    if (patch.unitDecision === "close_and_start") {
      current.status = "closing_candidate";
      current.deferredStart = {
        workingTitle: patch.workingUnitTitle,
        startedAtSequence: transcript.sequence,
        sourceItemIds: [transcript.itemId],
        knowledgeUnits: newKnowledgeUnits,
      };
      appendRawLog(session, "system", "unit_close_candidate", {
        sessionId: session.id,
        baseRevision: patch.baseRevision,
        currentRevision: session.lectureMemory.revision,
        sourceItemIds: [transcript.itemId],
        unitId: current.id,
        durationMs: 0,
        reason: "clear_transition_requires_confirmation",
      });
    } else {
      mergeIntoCurrent(
        current,
        transcript,
        newKnowledgeUnits,
        patch.activity === "instruction" || patch.activity === "example",
      );
      if (patch.workingUnitTitle) current.workingTitle = patch.workingUnitTitle;
      if (patch.unitDecision === "close_candidate" || patch.unitDecision === "close_and_wait") {
        current.status = "closing_candidate";
        appendRawLog(session, "system", "unit_close_candidate", {
          sessionId: session.id,
          baseRevision: patch.baseRevision,
          currentRevision: session.lectureMemory.revision,
          sourceItemIds: [transcript.itemId],
          unitId: current.id,
          durationMs: 0,
          reason: patch.unitDecision,
        });
      }
    }
  } else if (patch.unitDecision === "continue") {
    const deferred = current.deferredStart;
    current.deferredStart = null;
    current.status = "open";
    mergeIntoCurrent(
      current,
      transcript,
      [
        ...(deferred?.knowledgeUnits ?? []),
        ...newKnowledgeUnits,
      ],
      patch.activity === "instruction" || patch.activity === "example",
    );
    if (patch.workingUnitTitle) current.workingTitle = patch.workingUnitTitle;
  } else if (patch.unitDecision === "close_candidate") {
    mergeIntoCurrent(
      current,
      transcript,
      newKnowledgeUnits,
      patch.activity === "instruction" || patch.activity === "example",
    );
    appendRawLog(session, "system", "unit_close_candidate", {
      sessionId: session.id,
      baseRevision: patch.baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: [transcript.itemId],
      unitId: current.id,
      durationMs: 0,
      reason: "candidate_remains_uncertain",
    });
  } else {
    const deferred = current.deferredStart;
    const startsNext = patch.unitDecision === "close_and_start" || deferred !== null;
    if (!startsNext) {
      mergeIntoCurrent(
        current,
        transcript,
        newKnowledgeUnits,
        patch.activity === "instruction" || patch.activity === "example",
      );
    }
    applyBackwardEmphasis(
      current.provisionalKnowledge,
      patch,
      allowEmphasis,
    );
    finalizedUnit = finalizeCurrentUnit(session);
    const nextKnowledge = startsNext
      ? deduplicateKnowledgeUnits([
          ...(deferred?.knowledgeUnits ?? []),
          ...newKnowledgeUnits,
        ])
      : [];
    if (nextKnowledge.length > 0) {
      session.lectureMemory.currentUnit = createOpenUnit(
        transcript,
        patch.workingUnitTitle ?? deferred?.workingTitle ?? null,
        nextKnowledge,
        unique([
          ...(deferred?.sourceItemIds ?? []),
          transcript.itemId,
        ]),
      );
    }
  }

  current = session.lectureMemory.currentUnit;
  if (current) {
    if (patch.cancelPendingEmphasis) current.pendingEmphasis = null;
    applyBackwardEmphasis(
      current.provisionalKnowledge,
      patch,
      allowEmphasis,
    );
    if (allowEmphasis && patch.pendingEmphasis) {
      const allowedItems = new Set(context.allowedSourceItemIds);
      const triggerItemIds = patch.pendingEmphasis.triggerItemIds.filter(
        (itemId) => allowedItems.has(itemId),
      );
      if (triggerItemIds.length > 0) {
        current.pendingEmphasis = {
          id: randomUUID(),
          importance: patch.pendingEmphasis.importance,
          expectedCount: patch.pendingEmphasis.expectedCount,
          collectedKnowledgeUnitIds: [],
          triggerItemIds,
        };
      }
    }
  }

  if (patch.unitSummary !== null) {
    session.lectureMemory.recentTopicSummary = patch.unitSummary;
  }
  session.lectureMemory.revision += 1;
  session.lectureMemory = LectureMemorySchema.parse(session.lectureMemory);
  touchSession(session);
  appendRawLog(session, "system", "lecture_patch_applied", {
    sessionId: session.id,
    baseRevision: patch.baseRevision,
    currentRevision: session.lectureMemory.revision,
    sourceItemIds: [transcript.itemId],
    unitId: finalizedUnit?.id ?? session.lectureMemory.currentUnit?.id ?? null,
    durationMs: 0,
    reason: patch.unitDecision,
  });
  if (finalizedUnit) {
    appendRawLog(session, "system", "unit_finalized", {
      sessionId: session.id,
      baseRevision: patch.baseRevision,
      currentRevision: session.lectureMemory.revision,
      sourceItemIds: finalizedUnit.sourceItemIds,
      unitId: finalizedUnit.id,
      durationMs: 0,
      reason: "confirmed_semantic_transition",
    });
  }
  return { applied: true, finalizedUnit, reason: patch.unitDecision };
}
