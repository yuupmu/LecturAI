"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

interface PdfDocumentState {
  document: PDFDocumentProxy | null;
  loading: boolean;
  error: string | null;
}

interface LoadedPdfDocumentState extends PdfDocumentState {
  url: string | null;
}

// Loads one object URL once and destroys PDF.js resources when the URL changes.
export function usePdfDocument(pdfUrl: string | null): PdfDocumentState {
  const [state, setState] = useState<LoadedPdfDocumentState>({
    url: null,
    document: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!pdfUrl) return;

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let documentProxy: PDFDocumentProxy | null = null;
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loadingTask = pdfjs.getDocument({ url: pdfUrl });
        documentProxy = await loadingTask.promise;
        if (!active) {
          await loadingTask.destroy();
          return;
        }
        setState({
          url: pdfUrl,
          document: documentProxy,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          url: pdfUrl,
          document: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
      void loadingTask?.destroy();
      if (documentProxy) void documentProxy.cleanup();
    };
  }, [pdfUrl]);

  if (!pdfUrl) return { document: null, loading: false, error: null };
  if (state.url !== pdfUrl) {
    return { document: null, loading: true, error: null };
  }
  return state;
}
