import { useCallback, useEffect, useRef, useState } from "react";

import {
  classifyPdfError as defaultClassifyPdfError,
  getDocument as defaultGetDocument,
  getPdfMetrics as defaultGetPdfMetrics,
  transportHintForContentLength,
  type GnoDocumentLoadingTask,
  type PdfFallbackReason,
  type PDFDocumentProxy,
  type PdfTransportHint,
} from "../lib/pdf";

export type PdfDocumentStatus = "loading" | "ready" | "error";

export type UsePdfDocumentResult = {
  status: PdfDocumentStatus;
  doc: PDFDocumentProxy | null;
  numPages: number;
  firstPageReady: boolean;
  error: PdfFallbackReason | null;
  errorMessage: string | null;
  docId: string | null;
  retry: () => void;
};

/**
 * Optional test doubles only. Production call sites pass nothing and use the
 * facade defaults. Not a public product API surface.
 */
export type UsePdfDocumentDeps = {
  getDocument?: typeof defaultGetDocument;
  classifyPdfError?: typeof defaultClassifyPdfError;
  getPdfMetrics?: typeof defaultGetPdfMetrics;
  /** HEAD-probe transport; the JSON API helper cannot carry a HEAD. */
  fetch?: FetchLike;
};

/** Minimal fetch shape the HEAD probe needs (same-origin string URL only). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type LoadOwnership = {
  /** Minted opaque id for this load attempt; null until the probe settles. */
  docId: string | null;
  /** Null while the HEAD probe is in flight; never created once torn down. */
  task: GnoDocumentLoadingTask | null;
  /** Set only after promise resolves into viewer ownership. */
  viewerDoc: PDFDocumentProxy | null;
  /** True once teardown for this load has run (idempotent). */
  tornDown: boolean;
  /** True once documentDestroy was emitted (success path only). */
  destroyMetricEmitted: boolean;
};

/** Module-level so the effect dependency stays referentially stable. */
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * Probe the asset size with one same-origin HEAD (fn-136 R1). Network failure,
 * a non-2xx status, or a missing/invalid Content-Length all fall back to the
 * ranged tier; the probe never rejects and never fails the document.
 */
async function probeTransportHint(
  url: string,
  fetchImpl: FetchLike
): Promise<PdfTransportHint> {
  try {
    const response = await fetchImpl(url, { method: "HEAD" });
    if (!response.ok) {
      return "ranged";
    }
    const header = response.headers.get("content-length");
    if (header === null || !/^\d+$/u.test(header.trim())) {
      return "ranged";
    }
    return transportHintForContentLength(Number(header));
  } catch {
    return "ranged";
  }
}

/**
 * Load a PDF document from a same-origin asset URL.
 *
 * Teardown ownership (I3-04): loadingTask.destroy() owns the transport for the
 * entire load lifecycle. documentDestroy is emitted exactly once per
 * successfully loaded viewer instance, never for rejected/never-loaded
 * attempts.
 */
export function usePdfDocument(
  url: string | null,
  deps: UsePdfDocumentDeps = {}
): UsePdfDocumentResult {
  const getDocument = deps.getDocument ?? defaultGetDocument;
  const classifyPdfError = deps.classifyPdfError ?? defaultClassifyPdfError;
  const getPdfMetrics = deps.getPdfMetrics ?? defaultGetPdfMetrics;
  const fetchImpl = deps.fetch ?? defaultFetch;

  const [status, setStatus] = useState<PdfDocumentStatus>("loading");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [error, setError] = useState<PdfFallbackReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const generationRef = useRef(0);
  const ownershipRef = useRef<LoadOwnership | null>(null);

  const retry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!url) {
      setStatus("error");
      setError("network");
      setErrorMessage("No document URL");
      setDoc(null);
      setNumPages(0);
      setFirstPageReady(false);
      setDocId(null);
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const metrics = getPdfMetrics();

    setStatus("loading");
    setDoc(null);
    setNumPages(0);
    setFirstPageReady(false);
    setError(null);
    setErrorMessage(null);

    setDocId(null);

    const ownership: LoadOwnership = {
      docId: null,
      task: null,
      viewerDoc: null,
      tornDown: false,
      destroyMetricEmitted: false,
    };
    ownershipRef.current = ownership;

    const isStale = (): boolean => {
      if (generation !== generationRef.current) {
        return true;
      }
      if (ownership.tornDown) {
        return true;
      }
      return Boolean(
        (ownership.task as { destroyed?: boolean } | null)?.destroyed
      );
    };

    /**
     * Idempotent teardown for this load.
     * - Destroy the loading task exactly once when one exists; a load torn
     *   down during the HEAD probe never creates a task.
     * - Emit documentDestroy only for a viewer-owned success.
     * - A stale late resolution needs no separate proxy cleanup: the loading
     *   task already owns and destroys its transport.
     */
    const teardown = (): void => {
      if (ownership.tornDown) {
        return;
      }
      ownership.tornDown = true;

      const viewerDoc = ownership.viewerDoc;
      ownership.viewerDoc = null;

      if (viewerDoc && ownership.docId !== null) {
        if (!ownership.destroyMetricEmitted) {
          ownership.destroyMetricEmitted = true;
          metrics.recordDocumentDestroy({ docId: ownership.docId });
        }
      }

      const task = ownership.task;
      if (task) {
        try {
          void task.destroy().catch(() => undefined);
        } catch {
          // ignore
        }
      }
    };

    const failLoad = (err: unknown): void => {
      if (isStale()) {
        return;
      }
      const reason = classifyPdfError(err);
      setStatus("error");
      setError(reason);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setDoc(null);
      setNumPages(0);
      setFirstPageReady(false);
      teardown();
    };

    // One HEAD per document load picks the transport tier; the load itself
    // starts only if this generation is still live once the probe settles.
    // A synchronous getDocument failure routes through the same error path.
    void probeTransportHint(url, fetchImpl)
      .then((transport) => {
        if (isStale()) {
          return;
        }
        const loadingTask = getDocument({ url, transport });
        ownership.task = loadingTask;
        ownership.docId = loadingTask.gnoDocId;
        setDocId(loadingTask.gnoDocId);

        loadingTask.promise
          .then(async (pdf) => {
            if (isStale()) {
              teardown();
              return;
            }
            ownership.viewerDoc = pdf;
            setDoc(pdf);
            setNumPages(pdf.numPages);
            setStatus("ready");
            setFirstPageReady(pdf.numPages > 0);
          })
          .catch(failLoad);
      })
      .catch(failLoad);

    return () => {
      if (ownershipRef.current === ownership) {
        ownershipRef.current = null;
      }
      teardown();
    };
  }, [
    url,
    retryToken,
    getDocument,
    classifyPdfError,
    getPdfMetrics,
    fetchImpl,
  ]);

  return {
    status,
    doc,
    numPages,
    firstPageReady,
    error,
    errorMessage,
    docId,
    retry,
  };
}
