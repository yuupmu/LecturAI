"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LiveTranslationSegmentDto,
  TranscriptDto,
  TranscriptSelectionDto,
  TranslationSettingsDto,
  TranslationTargetLanguageDto,
} from "@/frontend/types";
import { TranscriptSelectionPopover } from "./TranscriptSelectionPopover";
import styles from "./LectureNotebook.module.css";

interface ActiveTranscriptSelection extends TranscriptSelectionDto {
  clientRect: { top: number; left: number; width: number; height: number };
  popoverTop: number;
  popoverLeft: number;
}

const MIN_SELECTION_LENGTH = 4;
const POPOVER_WIDTH = 252;
const POPOVER_HEIGHT = 104;

export function TranscriptNotebook({
  transcripts,
  partials,
  translationSettings,
  translations = [],
  embedded = false,
  showUnderstandingButton = true,
  highlightItemId = null,
  onStartUnderstanding,
  onAskSelection,
}: {
  transcripts: TranscriptDto[];
  partials: ReadonlyMap<string, string>;
  translationSettings?: TranslationSettingsDto;
  translations?: LiveTranslationSegmentDto[];
  embedded?: boolean;
  showUnderstandingButton?: boolean;
  highlightItemId?: string | null;
  onStartUnderstanding?: (selection?: TranscriptSelectionDto) => Promise<void>;
  onAskSelection?: (
    selection: TranscriptSelectionDto,
    anchor: { top: number; left: number },
  ) => Promise<void>;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const previousCountRef = useRef(0);
  const [newTurnCount, setNewTurnCount] = useState(0);
  const [selection, setSelection] = useState<ActiveTranscriptSelection | null>(
    null,
  );
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionPendingAction, setSelectionPendingAction] = useState<
    "immediate" | null
  >(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const translationActive = translationSettings?.enabled === true &&
    translationSettings.targetLanguage !== null;
  const currentTranslations = translations
    .filter((segment) =>
      translationActive &&
      segment.settingsRevision === translationSettings.revision &&
      segment.targetLanguage === translationSettings.targetLanguage
    )
    .sort((left, right) =>
      left.sequence - right.sequence || left.createdAt - right.createdAt
    );
  const translationByTranscript = new Map(
    currentTranslations.map((segment) => [
      `${segment.itemId}:${segment.sequence}`,
      segment,
    ]),
  );
  const latestTranslationId = currentTranslations.at(-1)?.id ?? null;
  const transcriptIds = new Set(transcripts.map((turn) => turn.itemId));
  const visibleSelection = selection && selection.sourceItemIds.every(
    (itemId) => transcriptIds.has(itemId),
  )
    ? selection
    : null;

  const scrollToLatest = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setNewTurnCount(0);
  };

  useEffect(() => {
    if (!highlightItemId) return;
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-transcript-row-id="${CSS.escape(highlightItemId)}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    atBottomRef.current = true;
    setNewTurnCount(0);
  }, [highlightItemId]);

  useEffect(() => {
    const added = Math.max(0, transcripts.length - previousCountRef.current);
    previousCountRef.current = transcripts.length;
    if (added === 0) return;
    if (atBottomRef.current) {
      requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    } else {
      setNewTurnCount((current) => current + added);
    }
  }, [transcripts.length]);

  useEffect(() => {
    if (!visibleSelection) return;
    const dismiss = () => {
      setSelection(null);
      setSelectionError(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visibleSelection]);

  const captureSelection = () => {
    if (!onAskSelection) return;
    const scroller = scrollerRef.current;
    const browserSelection = window.getSelection();
    if (!scroller || !browserSelection || browserSelection.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = browserSelection.rangeCount > 0
      ? browserSelection.getRangeAt(0)
      : null;
    if (!range || !scroller.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const startElement = closestSelectionSegment(range.startContainer);
    const endElement = closestSelectionSegment(range.endContainer);
    if (!startElement || !endElement ||
      !scroller.contains(startElement) || !scroller.contains(endElement)) {
      setSelection(null);
      return;
    }

    const sourceElements = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-transcript-selection='true']"),
    ).filter((element) => rangeIntersectsNode(range, element));
    const kind = startElement.dataset.selectionKind;
    if (
      (kind !== "original" && kind !== "translation") ||
      sourceElements.length === 0 ||
      sourceElements.some((element) => element.dataset.selectionKind !== kind)
    ) {
      setSelection(null);
      return;
    }
    const selectedText = extractTranscriptSelection(range, sourceElements).trim();
    if (selectedText.replace(/\s/gu, "").length < MIN_SELECTION_LENGTH) {
      setSelection(null);
      return;
    }

    const sourceItemIds = unique(sourceElements.flatMap((element) => {
      const itemId = element.dataset.transcriptItemId;
      return itemId ? [itemId] : [];
    }));
    const sequences = sourceElements.flatMap((element) => {
      const sequence = Number(element.dataset.sequence);
      return Number.isInteger(sequence) ? [sequence] : [];
    });
    if (sourceItemIds.length === 0 || sourceItemIds.length !== sequences.length) {
      setSelection(null);
      return;
    }
    const targetLanguage = kind === "translation"
      ? parseTargetLanguage(startElement.dataset.translationLanguage)
      : null;
    const translationIds = kind === "translation"
      ? sourceElements.flatMap((element) => {
          const translationId = element.dataset.translationId;
          return translationId ? [translationId] : [];
        })
      : [];
    if (
      kind === "translation" &&
      (!targetLanguage || translationIds.length !== sourceElements.length ||
        new Set(translationIds).size !== translationIds.length)
    ) {
      setSelection(null);
      return;
    }

    const rangeRect = range.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const popoverLeft = clamp(
      rangeRect.left + rangeRect.width / 2 - POPOVER_WIDTH / 2,
      scrollerRect.left + 8,
      Math.max(scrollerRect.left + 8, scrollerRect.right - POPOVER_WIDTH - 8),
    );
    const preferredTop = rangeRect.bottom + 8;
    const popoverTop = clamp(
      preferredTop + POPOVER_HEIGHT <= scrollerRect.bottom
        ? preferredTop
        : rangeRect.top - POPOVER_HEIGHT - 8,
      scrollerRect.top + 8,
      Math.max(scrollerRect.top + 8, scrollerRect.bottom - POPOVER_HEIGHT - 8),
    );
    setSelection({
      selectedText,
      sourceItemIds,
      startSequence: Math.min(...sequences),
      endSequence: Math.max(...sequences),
      kind,
      targetLanguage,
      translationIds,
      clientRect: {
        top: rangeRect.top,
        left: rangeRect.left,
        width: rangeRect.width,
        height: rangeRect.height,
      },
      popoverTop,
      popoverLeft,
    });
    setSelectionError(null);
  };

  const requestSelectionHelp = async (anchor: { top: number; left: number }) => {
    if (!visibleSelection || selectionBusy) return;
    const selectedPayload: TranscriptSelectionDto = {
      selectedText: visibleSelection.selectedText,
      sourceItemIds: visibleSelection.sourceItemIds,
      startSequence: visibleSelection.startSequence,
      endSequence: visibleSelection.endSequence,
      kind: visibleSelection.kind,
      targetLanguage: visibleSelection.targetLanguage,
      translationIds: visibleSelection.translationIds,
      intent: "explain",
    };
    if (!onAskSelection) return;
    setSelectionBusy(true);
    setSelectionPendingAction("immediate");
    setSelectionError(null);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    try {
      await onAskSelection(selectedPayload, anchor);
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : "도움 요청을 보내지 못했습니다.",
      );
    } finally {
      setSelectionBusy(false);
      setSelectionPendingAction(null);
    }
  };

  const requestLatestHelp = async () => {
    if (!onStartUnderstanding || selectionBusy) return;
    setSelectionBusy(true);
    setSelectionPendingAction("immediate");
    setSelectionError(null);
    try {
      await onStartUnderstanding();
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : "도움 요청을 보내지 못했습니다.",
      );
    } finally {
      setSelectionBusy(false);
      setSelectionPendingAction(null);
    }
  };

  return (
    <section
      className={`${styles.transcriptNotebook} ${embedded ? styles.transcriptEmbedded : ""} ${translationActive ? styles.transcriptTranslated : ""}`}
      aria-label="전체 수업 대본"
    >
      <header>
        <div>
          <strong>TRANSCRIPT NOTEBOOK</strong>
          <span>
            {translationActive
              ? `ORIGINAL ↔ ${translationSettings.targetLanguage === "ko" ? "한국어" : "ENGLISH"}`
              : "원본 확정 대본"} · {transcripts.length}개 발화
          </span>
        </div>
        {showUnderstandingButton && transcripts.length > 0 && onStartUnderstanding && (
          <button
            type="button"
            disabled={selectionBusy}
            onClick={() => void requestLatestHelp()}
          >
            {selectionBusy ? "AI가 분석하고 있어요…" : "방금 내용이 이해되지 않아요"}
          </button>
        )}
        {newTurnCount > 0 && (
          <button type="button" onClick={scrollToLatest}>
            새 발화 {newTurnCount}개 ↓
          </button>
        )}
      </header>
      <div
        ref={scrollerRef}
        className={styles.transcriptScroller}
        onMouseUp={captureSelection}
        onScroll={(event) => {
          const target = event.currentTarget;
          const nearBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight < 56;
          atBottomRef.current = nearBottom;
          if (nearBottom) setNewTurnCount(0);
          if (visibleSelection) {
            setSelection(null);
            setSelectionError(null);
          }
        }}
      >
        {transcripts.length === 0 && partials.size === 0 && (
          <p className={styles.emptyTranscript}>
            확정된 발화를 기다리고 있습니다. 대본은 필기 생성과 독립적으로 여기에 계속 쌓입니다.
          </p>
        )}
        <ol>
          {transcripts.map((transcript) => {
            const translation = translationByTranscript.get(
              `${transcript.itemId}:${transcript.sequence}`,
            );
            return (
            <li
              id={`transcript-${transcript.itemId}`}
              data-transcript-row-id={transcript.itemId}
              tabIndex={highlightItemId === transcript.itemId ? -1 : undefined}
              key={transcript.id}
              className={`${translationActive ? styles.translatedTurn : ""} ${highlightItemId === transcript.itemId ? styles.rejoinHighlight : ""}`}
            >
              <div className={styles.turnMeta}>
                <span>#{String(transcript.sequence).padStart(3, "0")}</span>
                <time dateTime={transcript.receivedAt}>
                  {formatTurnTime(transcript.receivedAt)}
                </time>
              </div>
              <div className={styles.originalTurn}>
                <p
                  data-transcript-selection="true"
                  data-selection-kind="original"
                  data-transcript-item-id={transcript.itemId}
                  data-sequence={transcript.sequence}
                >
                  {transcript.text}
                </p>
              </div>
              {translationActive && (
                <div
                  className={`${styles.translationTurn} ${translation?.id === latestTranslationId ? styles.latestTranslation : ""}`}
                  lang={translationSettings.targetLanguage ?? undefined}
                >
                  {!translation && (
                    <span className={styles.translationUnavailable} aria-label="번역 기능을 켜기 전 발화">—</span>
                  )}
                  {translation?.status === "translating" && (
                    <span className={styles.translationProgress} role="status">
                      <i aria-hidden="true" /> AI 번역 중…
                    </span>
                  )}
                  {translation?.status === "complete" && (
                    <p
                      data-transcript-selection="true"
                      data-selection-kind="translation"
                      data-translation-id={translation.id}
                      data-translation-language={translation.targetLanguage}
                      data-transcript-item-id={transcript.itemId}
                      data-sequence={transcript.sequence}
                    >
                      {translation.translatedText}
                    </p>
                  )}
                  {translation?.status === "failed" && (
                    <p className={styles.translationError} role="status">
                      {translation.errorMessage ?? "방금 자막을 번역하지 못했습니다. 다음 발화부터 계속 번역합니다."}
                    </p>
                  )}
                </div>
              )}
            </li>
            );
          })}
        </ol>
        {partials.size > 0 && (
          <div
            className={`${styles.partialTurns} ${translationActive ? styles.partialTurnsTranslated : ""}`}
            aria-live="polite"
          >
            {Array.from(partials.entries()).map(([itemId, text]) => (
              <p key={itemId}>{text || "…"}</p>
            ))}
          </div>
        )}
      </div>
      {visibleSelection && (
        <TranscriptSelectionPopover
          top={visibleSelection.popoverTop}
          left={visibleSelection.popoverLeft}
          busy={selectionBusy}
          error={selectionError}
          selectionKind={visibleSelection.kind}
          targetLanguage={visibleSelection.targetLanguage}
          pendingAction={selectionPendingAction}
          onImmediate={(anchor) => void requestSelectionHelp(anchor)}
        />
      )}
    </section>
  );
}

function closestSelectionSegment(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>("[data-transcript-selection='true']") ?? null;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function extractTranscriptSelection(
  range: Range,
  elements: HTMLElement[],
): string {
  return elements.flatMap((element) => {
    const itemRange = document.createRange();
    itemRange.selectNodeContents(element);
    if (element.contains(range.startContainer)) {
      itemRange.setStart(range.startContainer, range.startOffset);
    }
    if (element.contains(range.endContainer)) {
      itemRange.setEnd(range.endContainer, range.endOffset);
    }
    const value = itemRange.toString().trim();
    return value ? [value] : [];
  }).join("\n");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseTargetLanguage(
  value: string | undefined,
): TranslationTargetLanguageDto | null {
  return value === "ko" || value === "en" ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatTurnTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
