"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import styles from "./LiveLecture.module.css";

export interface LivePdfViewerProps {
  pdfUrl: string;
  currentPage: number | null;
  totalPages: number;
  transitionReason?: string;
}

// Renders only the resolved page while retaining a single PDFDocumentProxy.
export function LivePdfViewer({
  pdfUrl,
  currentPage,
  totalPages,
  transitionReason,
}: LivePdfViewerProps) {
  const { document: pdfDocument, loading, error } = usePdfDocument(pdfUrl);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const renderedPageRef = useRef<number | null>(null);
  const noticePageRef = useRef(currentPage ?? 1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [transitioning, setTransitioning] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [viewedPage, setViewedPage] = useState(currentPage ?? 1);
  const desiredPage = Math.max(
    1,
    Math.min(viewedPage, pdfDocument?.numPages ?? Math.max(1, totalPages)),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setContainerSize({
        width: Math.max(0, rect?.width ?? 0),
        height: Math.max(0, rect?.height ?? 0),
      });
    });
    observer.observe(container);
    const rect = container.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      !pdfDocument ||
      !canvasRef.current ||
      containerSize.width <= 0 ||
      containerSize.height <= 0
    ) return;
    let active = true;
    let delayId: ReturnType<typeof setTimeout> | null = null;
    const pageChanged =
      renderedPageRef.current !== null && renderedPageRef.current !== desiredPage;
    if (pageChanged) setTransitioning(true);

    const render = async () => {
      renderTaskRef.current?.cancel();
      try {
        const page = await pdfDocument.getPage(desiredPage);
        if (!active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.max(
          0.2,
          Math.min(
            (containerSize.width - 34) / baseViewport.width,
            (containerSize.height - 34) / baseViewport.height,
          ),
        );
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const buffer = document.createElement("canvas");
        buffer.width = Math.floor(viewport.width * pixelRatio);
        buffer.height = Math.floor(viewport.height * pixelRatio);
        const context = buffer.getContext("2d");
        if (!context) throw new Error("PDF_CANVAS_CONTEXT_UNAVAILABLE");
        const task = page.render({
          canvas: buffer,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        renderTaskRef.current = task;
        await task.promise;
        if (!active || !canvasRef.current) return;
        const visible = canvasRef.current;
        visible.width = buffer.width;
        visible.height = buffer.height;
        visible.style.width = `${viewport.width}px`;
        visible.style.height = `${viewport.height}px`;
        const visibleContext = visible.getContext("2d");
        if (!visibleContext) throw new Error("PDF_VISIBLE_CANVAS_UNAVAILABLE");
        visibleContext.clearRect(0, 0, visible.width, visible.height);
        visibleContext.drawImage(buffer, 0, 0);
        renderedPageRef.current = desiredPage;
        setTransitioning(false);
      } catch (renderError) {
        if (
          renderError instanceof Error &&
          renderError.name === "RenderingCancelledException"
        ) {
          return;
        }
        if (active) setTransitioning(false);
      }
    };

    delayId = setTimeout(() => void render(), pageChanged ? 110 : 0);
    return () => {
      active = false;
      if (delayId) clearTimeout(delayId);
      renderTaskRef.current?.cancel();
    };
  }, [containerSize, desiredPage, pdfDocument]);

  useEffect(() => {
    const nextPage = currentPage ?? 1;
    const pageChanged = noticePageRef.current !== nextPage;
    noticePageRef.current = nextPage;
    if (!pageChanged || renderedPageRef.current === null || !transitionReason) return;
    setNoticeVisible(true);
    const timeout = setTimeout(() => setNoticeVisible(false), 1_500);
    return () => clearTimeout(timeout);
  }, [currentPage, transitionReason]);

  return (
    <section className={styles.pdfStage} aria-label="현재 PDF 슬라이드">
      <header className={styles.pdfHeader}>
        <div>
          <strong>
            PAGE {String(desiredPage).padStart(2, "0")} / {String(pdfDocument?.numPages ?? totalPages).padStart(2, "0")}
          </strong>
          <span>사용자 페이지 탐색</span>
        </div>
        <nav aria-label="PDF 페이지 이동">
          <button
            type="button"
            onClick={() => setViewedPage(Math.max(1, desiredPage - 1))}
            disabled={desiredPage <= 1}
          >
            ← 이전
          </button>
          <button
            type="button"
            onClick={() => setViewedPage(Math.min(
              pdfDocument?.numPages ?? Math.max(1, totalPages),
              desiredPage + 1,
            ))}
            disabled={desiredPage >= (pdfDocument?.numPages ?? totalPages)}
          >
            다음 →
          </button>
        </nav>
      </header>
      <div ref={containerRef} className={styles.pdfCanvasViewport}>
        {loading && <p className={styles.pdfState}>PDF 페이지를 준비하고 있습니다.</p>}
        {error && <p className={styles.pdfError}>PDF 렌더링 실패 · {error}</p>}
        <canvas
          ref={canvasRef}
          className={`${styles.pdfCanvas} ${transitioning ? styles.pdfCanvasTransitioning : ""}`}
        />
        {noticeVisible && transitionReason && (
          <div className={styles.slideTransitionNotice} role="status">
            <strong>PAGE {String(desiredPage).padStart(2, "0")}으로 문맥 이동</strong>
            <span>{transitionReason}</span>
          </div>
        )}
      </div>
    </section>
  );
}
