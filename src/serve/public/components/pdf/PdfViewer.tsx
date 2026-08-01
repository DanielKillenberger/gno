import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { FitMode } from "../../hooks/use-pdf-pages";

import {
  clampZoom,
  DEFAULT_ZOOM,
  stepZoom,
  type PdfFallbackReason,
} from "../../lib/pdf";
import { Button } from "../ui/button";
import { usePdfViewerInternalDeps } from "./pdf-viewer-deps";
import { PdfPageView } from "./PdfPageView";
import { PdfToolbar } from "./PdfToolbar";

/**
 * Exact production contract (task .4 / R4).
 * No hook-injection props — tests use pdf-viewer-deps TestDepsProvider.
 */
export type PdfViewerProps = {
  assetUrl: string | null;
  downloadUrl: string;
  /**
   * Exact predicate computed by DocView:
   * contentAvailable && non-empty trimmed content string.
   * Viewer never re-derives this.
   */
  extractedTextAvailable: boolean;
  onFallback: (reason: PdfFallbackReason) => void;
};

type StatePanelProps = {
  testId: string;
  eyebrow: string;
  body: string;
  downloadUrl: string;
  /** loading/empty → status; error cards → alert */
  role: "status" | "alert";
  onRetry?: () => void;
  actions?: ReactNode;
};

/**
 * Flat state treatment inside the recessed well — no Card chrome
 * (no rounded border / tinted surface / shadow box).
 */
function StatePanel({
  testId,
  eyebrow,
  body,
  downloadUrl,
  role,
  onRetry,
}: StatePanelProps) {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center"
      data-testid={testId}
      role={role}
    >
      <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.15em]">
        {eyebrow}
      </p>
      <p className="text-[13px] text-foreground/90 leading-relaxed">{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {onRetry ? (
          <Button
            className="cursor-pointer focus-visible:ring-primary/50"
            data-testid="pdf-action-retry"
            onClick={onRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        ) : null}
        <Button
          asChild
          className="cursor-pointer focus-visible:ring-primary/50"
          data-testid="pdf-action-download"
          size="sm"
          variant="secondary"
        >
          <a download href={downloadUrl || undefined}>
            Download original
          </a>
        </Button>
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * User-facing PDF viewer: instrument rail + page column + designed states.
 * DocView owns the Pages/Text toggle; this shell never renders it.
 */
export function PdfViewer({
  assetUrl,
  downloadUrl,
  extractedTextAvailable,
  onFallback,
}: PdfViewerProps) {
  const { usePdfDocument, usePdfPages } = usePdfViewerInternalDeps();
  const docState = usePdfDocument(assetUrl);
  const { status, doc, numPages, error, docId, retry } = docState;

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [genId, setGenId] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const columnRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const fallbackFiredForLoadRef = useRef<string | null>(null);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  const bumpGen = useCallback(() => {
    setGenId((g) => g + 1);
  }, []);

  // Measure page column for fit modes
  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setContainerWidth(Math.max(0, Math.floor(width)));
      setContainerHeight(Math.max(0, Math.floor(height)));
    });
    ro.observe(el);
    setContainerWidth(Math.max(0, el.clientWidth));
    setContainerHeight(Math.max(0, el.clientHeight));
    return () => {
      ro.disconnect();
    };
  }, [status, numPages]);

  // Reset page/zoom when a new document loads
  useEffect(() => {
    if (status === "ready" && docId) {
      setPage(1);
      setZoom(DEFAULT_ZOOM);
      setFitMode("width");
      setGenId(1);
      fallbackFiredForLoadRef.current = null;
    }
  }, [docId, status]);

  // Real hook composition: genId from zoom/fit commits drives task .3 cancel path
  const pages = usePdfPages({
    doc: status === "ready" ? doc : null,
    docId: status === "ready" ? docId : null,
    numPages: status === "ready" ? numPages : 0,
    zoom,
    fitMode,
    containerWidth,
    containerHeight,
    genId,
  });
  const viewerError = status === "error" ? error : pages.error;

  // Fallback: exactly once per failed load/page attempt when extracted text exists.
  useEffect(() => {
    if (!viewerError || !extractedTextAvailable) {
      return;
    }
    const key = `${docId ?? assetUrl ?? "err"}:${viewerError}`;
    if (fallbackFiredForLoadRef.current === key) {
      return;
    }
    fallbackFiredForLoadRef.current = key;
    onFallbackRef.current(viewerError);
  }, [viewerError, extractedTextAvailable, docId, assetUrl]);

  const firstVisiblePage = pages.slots.find((slot) => slot.visible)?.pageNumber;

  // Native scrolling is intentionally left to the browser. Keep toolbar and
  // subsequent prev/next actions anchored to the first page currently visible
  // in the column instead of the last explicitly requested page.
  useEffect(() => {
    if (firstVisiblePage === undefined || numPages < 1) {
      return;
    }
    setPage(Math.min(numPages, Math.max(1, firstVisiblePage)));
  }, [firstVisiblePage, numPages]);

  // Keep page in range when numPages changes
  useEffect(() => {
    if (numPages < 1) {
      return;
    }
    setPage((p) => Math.min(numPages, Math.max(1, p)));
  }, [numPages]);

  const scrollToPage = useCallback((target: number) => {
    const el = columnRef.current?.querySelector(
      `[data-testid="pdf-page-${target}"]`
    );
    if (!(el instanceof HTMLElement)) {
      return;
    }
    el.scrollIntoView({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      if (numPages < 1) {
        return false;
      }
      const clamped = Math.min(numPages, Math.max(1, Math.trunc(next)));
      if (clamped === page) {
        return false;
      }
      setPage(clamped);
      requestAnimationFrame(() => {
        scrollToPage(clamped);
      });
      return true;
    },
    [numPages, page, scrollToPage]
  );

  // Boundary: when step cannot change zoom, no state/gen change (any fit mode)
  const zoomIn = useCallback(() => {
    const next = stepZoom(zoom, 1);
    if (next === zoom) {
      return false;
    }
    setZoom(next);
    setFitMode("custom");
    bumpGen();
    return true;
  }, [zoom, bumpGen]);

  /**
   * Commit an exact zoom level from the zoom-level combobox. Does exactly what
   * zoomIn/zoomOut already do — no new zoom math. Matching the accepted
   * boundary rule, an already-current level in `custom` fit mode makes no state
   * or generation change.
   */
  const zoomTo = useCallback(
    (level: number) => {
      const next = clampZoom(level);
      if (next === zoom && fitMode === "custom") {
        return false;
      }
      setZoom(next);
      setFitMode("custom");
      bumpGen();
      return true;
    },
    [zoom, fitMode, bumpGen]
  );

  const zoomOut = useCallback(() => {
    const next = stepZoom(zoom, -1);
    if (next === zoom) {
      return false;
    }
    setZoom(next);
    setFitMode("custom");
    bumpGen();
    return true;
  }, [zoom, bumpGen]);

  const zoomReset = useCallback(() => {
    if (zoom === DEFAULT_ZOOM && fitMode === "custom") {
      return false;
    }
    setZoom(DEFAULT_ZOOM);
    setFitMode("custom");
    bumpGen();
    return true;
  }, [zoom, fitMode, bumpGen]);

  const setFit = useCallback(
    (mode: "width" | "page") => {
      if (fitMode === mode) {
        return false;
      }
      setFitMode(mode);
      bumpGen();
      return true;
    },
    [fitMode, bumpGen]
  );

  const handleRetry = useCallback(() => {
    fallbackFiredForLoadRef.current = null;
    retry();
  }, [retry]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? "";
      const inInput =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;

      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === " " ||
        e.key === "Spacebar"
      ) {
        return;
      }

      if (inInput) {
        return;
      }

      const controlsLive = status === "ready" && numPages > 0;

      let handled = false;

      if (e.key === "PageDown" || e.key === "ArrowRight") {
        if (controlsLive && page < numPages) {
          handled = goToPage(page + 1);
        }
      } else if (e.key === "PageUp" || e.key === "ArrowLeft") {
        if (controlsLive && page > 1) {
          handled = goToPage(page - 1);
        }
      } else if (e.key === "+" || e.key === "=") {
        if (controlsLive) {
          handled = zoomIn();
        }
      } else if (e.key === "-" || e.key === "_") {
        if (controlsLive) {
          handled = zoomOut();
        }
      } else if (e.key === "0") {
        if (controlsLive) {
          handled = zoomReset();
        }
      }

      if (handled) {
        e.preventDefault();
      }
    },
    [status, numPages, page, goToPage, zoomIn, zoomOut, zoomReset]
  );

  // ── Designed states (real usePdfDocument semantics) ──────────────────
  // loading: only while status === "loading"
  // empty: ready + zero pages (firstPageReady is false for zero-page docs)
  // progressive: ready + numPages > 0
  // error: status === "error"
  const showLoading = status === "loading";
  const showEmpty = status === "ready" && numPages === 0;
  const showProgressive =
    status === "ready" && numPages > 0 && viewerError === null;
  const showError = viewerError !== null;
  const showErrorPanel = showError && !extractedTextAvailable;

  const errorPanel = (() => {
    if (!showErrorPanel || !viewerError) {
      return null;
    }
    switch (viewerError) {
      case "corrupt":
        return (
          <StatePanel
            body="This PDF could not be rendered. Download the original to read it."
            downloadUrl={downloadUrl}
            eyebrow="CANNOT RENDER"
            onRetry={handleRetry}
            role="alert"
            testId="pdf-state-corrupt"
          />
        );
      case "password":
        return (
          <StatePanel
            body="This PDF is password protected. Download the original to open it in a PDF reader."
            downloadUrl={downloadUrl}
            eyebrow="PASSWORD PROTECTED"
            role="alert"
            testId="pdf-state-password"
          />
        );
      case "network":
        return (
          <StatePanel
            body="The document could not be loaded from this session. Try again, or download the original."
            downloadUrl={downloadUrl}
            eyebrow="COULD NOT LOAD"
            onRetry={handleRetry}
            role="alert"
            testId="pdf-state-network"
          />
        );
      case "bootstrap":
        return (
          <StatePanel
            body="The PDF viewer could not start in this window. Download the original to read it."
            downloadUrl={downloadUrl}
            eyebrow="VIEWER UNAVAILABLE"
            onRetry={handleRetry}
            role="alert"
            testId="pdf-state-bootstrap"
          />
        );
      default:
        return null;
    }
  })();

  const toolbarDisabled = showEmpty || showLoading || showError;

  return (
    <section
      aria-label="PDF viewer"
      className="gno-pdf-viewer relative flex flex-col rounded-lg border border-border/40 bg-gradient-to-br from-background to-muted/10 shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      data-testid="pdf-viewer"
      onKeyDown={handleKeyDown}
      ref={viewerRef}
      tabIndex={0}
    >
      <PdfToolbar
        disabled={toolbarDisabled || numPages < 1}
        downloadUrl={downloadUrl}
        fitMode={fitMode}
        numPages={showProgressive ? numPages : 0}
        onFitMode={(m) => {
          setFit(m);
        }}
        onPageChange={(p) => {
          goToPage(p);
        }}
        onZoomIn={() => {
          zoomIn();
        }}
        onZoomOut={() => {
          zoomOut();
        }}
        onZoomTo={(level) => {
          zoomTo(level);
        }}
        page={showProgressive ? page : 0}
        zoom={zoom}
      />

      <div
        className="gno-pdf-page-column h-[min(78dvh,1100px)] min-h-[420px] overflow-y-auto px-4 py-6"
        data-testid="pdf-page-column"
        ref={columnRef}
      >
        {showLoading ? (
          <div
            className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center"
            data-testid="pdf-state-loading"
            role="status"
          >
            <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.15em]">
              LOADING
            </p>
            <p className="text-[13px] text-foreground/90 leading-relaxed">
              Preparing document…
            </p>
          </div>
        ) : null}

        {showEmpty ? (
          <StatePanel
            body="This PDF has no pages."
            downloadUrl={downloadUrl}
            eyebrow="EMPTY DOCUMENT"
            role="status"
            testId="pdf-state-empty"
          />
        ) : null}

        {errorPanel}

        {showProgressive ? (
          <div className="mx-auto flex w-fit flex-col items-center gap-6">
            {pages.slots.map((slot) => (
              <PdfPageView
                key={slot.pageNumber}
                active={slot.active}
                doc={doc}
                height={slot.height}
                onMount={pages.observePage}
                onInternalNavigate={goToPage}
                onRender={pages.ensureRendered}
                pageNumber={slot.pageNumber}
                rendered={slot.rendered}
                scale={pages.scale}
                width={slot.width}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Re-export for tests / consumers
export type { FitMode };
export { clampZoom, stepZoom, DEFAULT_ZOOM };
