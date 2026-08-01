import { useCallback, useEffect, useRef, useState } from "react";

import {
  computeEffectiveScale as defaultComputeEffectiveScale,
  getPdfMetrics as defaultGetPdfMetrics,
  isRenderingCancelled as defaultIsRenderingCancelled,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "../lib/pdf";

export const LIVE_CANVAS_CEILING = 10;
export const OVERSCAN_PAGES = 2;
/**
 * Visible-set quiescence required before a page that entered the live window
 * during scrolling is admitted to render. A **production behavior constant** —
 * never harness-derived, injected, or tuned from the smoke.
 *
 * Without this, an N-page traversal issues N `renderStart`s because every page
 * transiting the window starts a render (measured: 200 starts on the 200-page
 * P-3 procedure). Pages that enter and leave before quiescence are never
 * admitted and emit no metric events at all.
 */
export const SCROLL_QUIESCENCE_MS = 120;

export type FitMode = "width" | "page" | "custom";

export type PageSlotState = {
  pageNumber: number;
  /** CSS viewport width at current scale */
  width: number;
  /** CSS viewport height at current scale */
  height: number;
  rendered: boolean;
  /** True when IntersectionObserver reports the page is intersecting. */
  visible: boolean;
  /**
   * True when the page is in the live window (visible ± overscan) and should
   * mount canvas / TextLayer. Production PdfPageView `active` prop.
   */
  active: boolean;
};

export type UsePdfPagesOptions = {
  doc: PDFDocumentProxy | null;
  docId: string | null;
  numPages: number;
  /** Logical zoom (1 = 100%) when fitMode is custom; otherwise a hint. */
  zoom: number;
  fitMode: FitMode;
  containerWidth: number;
  containerHeight: number;
  /** Bumped by viewer on every zoom/fit/scale commit. */
  genId: number;
  devicePixelRatio?: number;
  /**
   * Optional test doubles only (not a product API). Production omits these.
   */
  getPdfMetrics?: typeof defaultGetPdfMetrics;
  computeEffectiveScale?: typeof defaultComputeEffectiveScale;
  isRenderingCancelled?: typeof defaultIsRenderingCancelled;
  /** Injectable IntersectionObserver for controlled tests. */
  IntersectionObserverImpl?: typeof IntersectionObserver;
};

export type UsePdfPagesResult = {
  slots: PageSlotState[];
  liveCanvasCount: number;
  observePage: (pageNumber: number, el: HTMLElement | null) => void;
  /**
   * Register a canvas and render when the page is in the live window.
   * Called by PdfPageView when `active` — not a manual test escape hatch for
   * arbitrary off-window pages (those are no-ops).
   */
  ensureRendered: (
    pageNumber: number,
    canvas: HTMLCanvasElement | null
  ) => Promise<void>;
  scale: number;
  /**
   * Awaited disposal barrier: cancel → settle → page.cleanup → canvas zero for
   * every live page. Effect cleanup triggers this but does not await; callers
   * and tests that need completion before document teardown must await this.
   */
  disposeAll: () => Promise<void>;
};

type PageCache = {
  page: PDFPageProxy;
  task: RenderTask | null;
  taskId: string | null;
  startGenId: number | null;
  /**
   * Logical scale this entry was rendered at. A generation bump and the
   * recomputed scale do NOT land in the same React pass (scale is derived from
   * the ResizeObserver-fed container width), so generation identity alone
   * cannot decide "already rendered" — see the same-generation scale change
   * guarded below.
   */
  startScale: number | null;
  canvas: HTMLCanvasElement | null;
  settled: boolean;
  /** Single-owner cancel promise — concurrent callers share one cancel/settle. */
  cancelClaim: Promise<void> | null;
};

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false;
    }
  }
  return true;
}

function computeActiveSet(
  visible: ReadonlySet<number>,
  numPages: number
): Set<number> {
  const active = new Set<number>();
  for (const p of visible) {
    for (
      let i = Math.max(1, p - OVERSCAN_PAGES);
      i <= Math.min(numPages, p + OVERSCAN_PAGES);
      i++
    ) {
      active.add(i);
    }
  }
  return active;
}

/** Mark a canvas as carrying a live pdfjs backing store (not browser defaults). */
function markLiveBacking(canvas: HTMLCanvasElement): void {
  canvas.dataset.gnoPdfBacking = "1";
}

/** Zero dimensions and clear the live-backing marker (eviction / rollback). */
function zeroCanvasBacking(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  delete canvas.dataset.gnoPdfBacking;
}

/**
 * Virtualized page render scheduling driven by IntersectionObserver.
 * Cancel → await settle → cleanup → zero-dims eviction, with metrics correlation.
 */
export function usePdfPages(options: UsePdfPagesOptions): UsePdfPagesResult {
  const {
    doc,
    docId,
    numPages,
    zoom,
    fitMode,
    containerWidth,
    containerHeight,
    genId,
    devicePixelRatio = typeof window !== "undefined"
      ? window.devicePixelRatio || 1
      : 1,
    getPdfMetrics = defaultGetPdfMetrics,
    computeEffectiveScale = defaultComputeEffectiveScale,
    isRenderingCancelled = defaultIsRenderingCancelled,
    IntersectionObserverImpl = typeof IntersectionObserver !== "undefined"
      ? IntersectionObserver
      : undefined,
  } = options;

  const [slots, setSlots] = useState<PageSlotState[]>([]);
  const [scale, setScale] = useState(1);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    () => new Set()
  );
  const [liveCanvasCount, setLiveCanvasCount] = useState(0);

  const cacheRef = useRef<Map<number, PageCache>>(new Map());
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const canvasRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const settledTaskIdsRef = useRef<Set<string>>(new Set());
  const metrics = getPdfMetrics();
  const genIdRef = useRef(genId);
  genIdRef.current = genId;

  /**
   * Deferred-admission state.
   *
   * `epochSeqRef` is a monotonic counter bumped synchronously on every `docId`
   * or `genId` change. Opening an epoch opens its *exempt batch*: while open,
   * every page passing the ordinary active-set guard is admitted immediately —
   * the whole initial window, and every active page after a zoom/fit commit.
   * The batch closes at the first visible-set mutation occurring *after* it has
   * admitted >= 1 page, and never reopens; only a new epoch opens the next.
   */
  const epochSeqRef = useRef(0);
  const epochKeyRef = useRef<string | null>(null);
  const epochBatchOpenRef = useRef(true);
  const epochAdmittedRef = useRef(0);
  const pendingRef = useRef<
    Map<
      number,
      {
        docId: string | null;
        genId: number;
        epochSeq: number;
        pageNumber: number;
        canvas: HTMLCanvasElement;
      }
    >
  >(new Map());
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<
    ((armedEpochSeq: number) => Promise<void>) | null
  >(null);

  const clearPending = useCallback((): void => {
    pendingRef.current.clear();
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  // Synchronous epoch bump (same pattern as genIdRef above): a doc or gen change
  // must open its exempt batch before any render path observes the new state.
  {
    const epochKey = `${docId ?? ""}:${genId}`;
    if (epochKeyRef.current !== epochKey) {
      epochKeyRef.current = epochKey;
      epochSeqRef.current += 1;
      epochBatchOpenRef.current = true;
      epochAdmittedRef.current = 0;
      pendingRef.current.clear();
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }
  }
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const visibleRef = useRef(visiblePages);
  visibleRef.current = visiblePages;
  const disposedRef = useRef(false);
  const disposePromiseRef = useRef<Promise<void> | null>(null);

  const markSettled = useCallback((taskId: string | null | undefined) => {
    if (taskId) {
      settledTaskIdsRef.current.add(taskId);
    }
  }, []);

  const hasSettled = useCallback((taskId: string | null | undefined) => {
    return Boolean(taskId && settledTaskIdsRef.current.has(taskId));
  }, []);

  const syncSlotWindow = useCallback(
    (visible: Set<number>) => {
      const active = computeActiveSet(visible, numPages);
      setSlots((prev) =>
        prev.map((s) => ({
          ...s,
          visible: visible.has(s.pageNumber),
          active: active.has(s.pageNumber),
        }))
      );
    },
    [numPages]
  );

  // Slot geometry from page 1 only — never eagerly getPage(1..N).
  useEffect(() => {
    let cancelled = false;
    if (!doc || numPages === 0) {
      setSlots([]);
      setScale(1);
      return;
    }

    void (async () => {
      try {
        const page1 = await doc.getPage(1);
        if (cancelled) {
          return;
        }
        const base = page1.getViewport({ scale: 1 });
        let nextScale = zoom;
        if (fitMode === "width" && containerWidth > 0) {
          nextScale = containerWidth / base.width;
        } else if (
          fitMode === "page" &&
          containerWidth > 0 &&
          containerHeight > 0
        ) {
          nextScale = Math.min(
            containerWidth / base.width,
            containerHeight / base.height
          );
        }
        nextScale = Math.max(0.25, Math.min(4, nextScale));
        setScale(nextScale);

        const vp = page1.getViewport({ scale: nextScale });
        const visible = visibleRef.current;
        const active = computeActiveSet(visible, numPages);
        const nextSlots: PageSlotState[] = [];
        for (let i = 1; i <= numPages; i++) {
          nextSlots.push({
            pageNumber: i,
            width: vp.width,
            height: vp.height,
            rendered: false,
            visible: visible.has(i),
            active: active.has(i),
          });
        }
        setSlots(nextSlots);
      } catch {
        // leave slots empty on failure
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, numPages, zoom, fitMode, containerWidth, containerHeight]);

  // IntersectionObserver drives visibility → slot.active/visible → PdfPageView.
  useEffect(() => {
    if (!IntersectionObserverImpl) {
      return;
    }
    observerRef.current?.disconnect();
    const observer = new IntersectionObserverImpl(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNumber = Number(
              (entry.target as HTMLElement).dataset.pageNumber
            );
            if (!Number.isFinite(pageNumber)) {
              continue;
            }
            if (entry.isIntersecting) {
              next.add(pageNumber);
            } else {
              next.delete(pageNumber);
            }
          }
          // The exempt batch closes at the first visible-set mutation *after* it
          // has admitted >= 1 page. Requiring a prior admission keeps the cold
          // start correct (there, this mutation is what makes the initial pages
          // active); requiring a subsequent mutation keeps later scroll entries
          // out of a batch that is already serving.
          if (!setsEqual(prev, next)) {
            if (epochBatchOpenRef.current && epochAdmittedRef.current > 0) {
              epochBatchOpenRef.current = false;
            }
            // Genuine visible-set churn restarts the quiescence window.
            if (pendingTimerRef.current !== null) {
              clearTimeout(pendingTimerRef.current);
              pendingTimerRef.current = setTimeout(() => {
                void flushPendingRef.current?.(epochSeqRef.current);
              }, SCROLL_QUIESCENCE_MS);
            }
          }
          return next;
        });
      },
      { root: null, rootMargin: "200px 0px", threshold: 0.01 }
    );
    observerRef.current = observer;
    for (const el of elementsRef.current.values()) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
  }, [numPages, IntersectionObserverImpl]);

  // Propagate visible set into slot.visible / slot.active.
  useEffect(() => {
    syncSlotWindow(visiblePages);
  }, [visiblePages, syncSlotWindow]);

  const observePage = useCallback(
    (pageNumber: number, el: HTMLElement | null) => {
      const prev = elementsRef.current.get(pageNumber);
      if (prev && observerRef.current) {
        observerRef.current.unobserve(prev);
      }
      if (!el) {
        elementsRef.current.delete(pageNumber);
        return;
      }
      el.dataset.pageNumber = String(pageNumber);
      elementsRef.current.set(pageNumber, el);
      observerRef.current?.observe(el);
    },
    []
  );

  /**
   * Single-owner cancel for a page's in-flight task.
   * Concurrent callers share one cancelClaim promise; at most one renderCancel
   * and one cancelled/failed settle per taskId.
   */
  const claimCancelInFlight = useCallback(
    async (pageNumber: number): Promise<void> => {
      const cached = cacheRef.current.get(pageNumber);
      if (!cached) {
        return;
      }
      if (!cached.task || cached.settled || !cached.taskId) {
        cached.task = null;
        return;
      }
      if (cached.cancelClaim) {
        await cached.cancelClaim;
        return;
      }
      if (hasSettled(cached.taskId)) {
        cached.task = null;
        cached.settled = true;
        return;
      }

      const { task, taskId, startGenId } = cached;
      if (startGenId == null || !docId || !task || !taskId) {
        return;
      }

      cached.cancelClaim = (async () => {
        // Claim is exclusive — record cancel once.
        if (!hasSettled(taskId)) {
          metrics.recordRenderCancel({
            docId,
            pageNumber,
            taskId,
            genId: startGenId,
          });
        }
        try {
          task.cancel();
        } catch {
          // ignore
        }
        try {
          await task.promise;
          if (!hasSettled(taskId)) {
            metrics.recordRenderSettle({
              docId,
              pageNumber,
              taskId,
              genId: startGenId,
              outcome: "cancelled",
            });
            markSettled(taskId);
          }
        } catch (err) {
          if (hasSettled(taskId)) {
            // already recorded
          } else if (isRenderingCancelled(err)) {
            metrics.recordRenderSettle({
              docId,
              pageNumber,
              taskId,
              genId: startGenId,
              outcome: "cancelled",
            });
            markSettled(taskId);
          } else {
            metrics.recordRenderSettle({
              docId,
              pageNumber,
              taskId,
              genId: startGenId,
              outcome: "failed",
            });
            markSettled(taskId);
          }
        }
        const still = cacheRef.current.get(pageNumber);
        if (still?.taskId === taskId) {
          still.task = null;
          still.settled = true;
          still.cancelClaim = null;
        }
      })();

      await cached.cancelClaim;
    },
    [docId, metrics, hasSettled, markSettled, isRenderingCancelled]
  );

  const cancelAndCleanup = useCallback(
    async (pageNumber: number): Promise<void> => {
      const cached = cacheRef.current.get(pageNumber);
      if (!cached) {
        canvasRef.current.delete(pageNumber);
        return;
      }
      await claimCancelInFlight(pageNumber);
      const still = cacheRef.current.get(pageNumber);
      if (!still) {
        canvasRef.current.delete(pageNumber);
        return;
      }
      try {
        still.page.cleanup();
      } catch {
        // ignore
      }
      if (docId) {
        metrics.recordPageCleanup({ docId, pageNumber });
      }
      if (still.canvas) {
        zeroCanvasBacking(still.canvas);
      }
      cacheRef.current.delete(pageNumber);
      canvasRef.current.delete(pageNumber);
      setLiveCanvasCount(cacheRef.current.size);
      setSlots((prev) =>
        prev.map((s) =>
          s.pageNumber === pageNumber ? { ...s, rendered: false } : s
        )
      );
    },
    [claimCancelInFlight, docId, metrics]
  );

  // Evict pages outside the live window / over ceiling.
  useEffect(() => {
    if (!docId || disposedRef.current) {
      return;
    }
    const active = computeActiveSet(visiblePages, numPages);
    const live = [...cacheRef.current.keys()];
    const outside = live.filter((p) => !active.has(p));
    const overCeiling = live.length > LIVE_CANVAS_CEILING;

    if (outside.length === 0 && !overCeiling) {
      return;
    }

    const dist = (p: number) => {
      let min = Number.POSITIVE_INFINITY;
      for (const v of visiblePages) {
        min = Math.min(min, Math.abs(v - p));
      }
      if (!Number.isFinite(min) && active.size > 0) {
        for (const v of active) {
          min = Math.min(min, Math.abs(v - p));
        }
      }
      return min;
    };

    const toEvict = [
      ...outside.sort((a, b) => dist(b) - dist(a)),
      ...live.filter((p) => active.has(p)).sort((a, b) => dist(b) - dist(a)),
    ];

    let remaining = cacheRef.current.size;
    for (const p of toEvict) {
      if (!cacheRef.current.has(p)) {
        continue;
      }
      const mustEvictOutside = !active.has(p);
      const mustEvictCeiling = remaining > LIVE_CANVAS_CEILING;
      if (!mustEvictOutside && !mustEvictCeiling) {
        break;
      }
      void cancelAndCleanup(p);
      remaining -= 1;
    }
  }, [visiblePages, numPages, docId, cancelAndCleanup]);

  // Gen bump: cancel in-flight tasks for the old gen only (no synthetic cancel).
  useEffect(() => {
    if (!docId) {
      return;
    }
    for (const [pageNumber, cached] of cacheRef.current) {
      if (
        cached.task &&
        !cached.settled &&
        cached.startGenId != null &&
        cached.startGenId !== genId
      ) {
        void claimCancelInFlight(pageNumber);
      }
    }
  }, [genId, docId, claimCancelInFlight]);

  /**
   * Ungated render path — today's render body verbatim. Never consults the
   * admission gate, so a pending flush can never re-defer recursively.
   * `admittedEpochSeq` is the token admission was decided under; it is
   * revalidated after every await alongside the existing dispose/gen/active
   * re-checks, and a mismatch abandons the attempt without starting a render.
   */
  const startRenderAdmitted = useCallback(
    async (
      pageNumber: number,
      canvas: HTMLCanvasElement | null,
      admittedEpochSeq: number
    ) => {
      if (
        !doc ||
        !docId ||
        !canvas ||
        pageNumber < 1 ||
        pageNumber > numPages ||
        disposedRef.current
      ) {
        return;
      }

      // Only pages in the live window (visible ± overscan) may render.
      const active = computeActiveSet(visibleRef.current, numPages);
      if (!active.has(pageNumber)) {
        canvasRef.current.delete(pageNumber);
        return;
      }

      canvasRef.current.set(pageNumber, canvas);

      const currentGen = genIdRef.current;
      const currentScale = scaleRef.current;

      /**
       * Full admission identity: {docId, genId, epochSeq, pageNumber, canvas}
       * plus live-window membership and DOM attachment. Re-checked after EVERY
       * await — a canvas replaced or detached while `getPage` was pending must
       * never receive a renderStart, a hidden metric event, or a backing-store
       * allocation.
       */
      const identityStillValid = (): boolean =>
        !disposedRef.current &&
        genIdRef.current === currentGen &&
        epochSeqRef.current === admittedEpochSeq &&
        computeActiveSet(visibleRef.current, numPages).has(pageNumber) &&
        canvasRef.current.get(pageNumber) === canvas &&
        canvas.isConnected;

      /**
       * Same identity, used after a cancel we ourselves initiated. Those paths
       * intentionally drop the page's `canvasRef` entry, so "no entry" means
       * "still ours"; only a *different* canvas claiming the page is a genuine
       * replacement. Ownership is re-asserted so the strict check above holds
       * at the post-`getPage` checkpoint.
       */
      const identityValidAfterOwnCancel = (): boolean => {
        if (
          disposedRef.current ||
          genIdRef.current !== currentGen ||
          epochSeqRef.current !== admittedEpochSeq ||
          !computeActiveSet(visibleRef.current, numPages).has(pageNumber) ||
          !canvas.isConnected
        ) {
          return false;
        }
        const owner = canvasRef.current.get(pageNumber);
        if (owner !== undefined && owner !== canvas) {
          return false;
        }
        canvasRef.current.set(pageNumber, canvas);
        return true;
      };

      // Evict farthest if at ceiling and this page is not cached
      if (
        !cacheRef.current.has(pageNumber) &&
        cacheRef.current.size >= LIVE_CANVAS_CEILING
      ) {
        let farthest = -1;
        let farthestDist = -1;
        for (const p of cacheRef.current.keys()) {
          let min = Number.POSITIVE_INFINITY;
          for (const v of visibleRef.current) {
            min = Math.min(min, Math.abs(v - p));
          }
          if (min > farthestDist) {
            farthestDist = min;
            farthest = p;
          }
        }
        if (farthest > 0) {
          await cancelAndCleanup(farthest);
          if (!identityValidAfterOwnCancel()) {
            return;
          }
        }
      }

      const existing = cacheRef.current.get(pageNumber);
      // In-flight at a different gen → await single-owner cancel, then replace.
      if (
        existing?.task &&
        !existing.settled &&
        existing.startGenId != null &&
        (existing.startGenId !== currentGen ||
          existing.startScale !== currentScale)
      ) {
        await claimCancelInFlight(pageNumber);
        if (!identityValidAfterOwnCancel()) {
          return;
        }
      }

      const afterCancel = cacheRef.current.get(pageNumber);
      if (
        afterCancel &&
        afterCancel.startGenId === currentGen &&
        afterCancel.startScale === currentScale &&
        afterCancel.canvas === canvas &&
        (afterCancel.task || afterCancel.settled)
      ) {
        if (afterCancel.settled && !afterCancel.task) {
          return;
        }
        if (afterCancel.task && !afterCancel.settled) {
          return;
        }
      }

      let page: PDFPageProxy;
      const still = cacheRef.current.get(pageNumber);
      if (still?.page) {
        page = still.page;
      } else {
        page = await doc.getPage(pageNumber);
      }

      // Full identity re-check after page acquisition, BEFORE any slot write,
      // metric event, or backing-store allocation.
      if (!identityStillValid()) {
        return;
      }

      const viewport = page.getViewport({ scale: currentScale });
      setSlots((prev) =>
        prev.map((s) =>
          s.pageNumber === pageNumber
            ? { ...s, width: viewport.width, height: viewport.height }
            : s
        )
      );

      const effective = computeEffectiveScale({
        zoom: currentScale,
        devicePixelRatio,
        cssWidth: viewport.width,
        cssHeight: viewport.height,
      });

      const taskId = metrics.mintTaskId();
      const startGenId = currentGen;
      const renderViewport = page.getViewport({ scale: effective.renderScale });

      // Allocate backing store only after we know we will attempt a render.
      // On pre-start failure: roll back dims + cleanup page (I3-05).
      const rollbackPreStart = () => {
        zeroCanvasBacking(canvas);
        try {
          page.cleanup();
        } catch {
          // ignore
        }
        if (docId) {
          metrics.recordPageCleanup({ docId, pageNumber });
        }
        cacheRef.current.delete(pageNumber);
        setLiveCanvasCount(cacheRef.current.size);
      };

      canvas.width = effective.canvasWidth;
      canvas.height = effective.canvasHeight;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      markLiveBacking(canvas);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rollbackPreStart();
        return;
      }

      let task: RenderTask;
      try {
        task = page.render({
          canvasContext: ctx,
          viewport: renderViewport,
          canvas,
        } as never);
      } catch {
        rollbackPreStart();
        return;
      }

      // Logical committed scale (not DPR/effective render scale).
      metrics.recordRenderStart({
        docId,
        pageNumber,
        taskId,
        genId: startGenId,
        scale: currentScale,
        canvasWidth: effective.canvasWidth,
        canvasHeight: effective.canvasHeight,
      });

      cacheRef.current.set(pageNumber, {
        page,
        task,
        taskId,
        startGenId,
        startScale: currentScale,
        canvas,
        settled: false,
        cancelClaim: null,
      });
      setLiveCanvasCount(cacheRef.current.size);

      try {
        await task.promise;
        if (hasSettled(taskId)) {
          return;
        }
        const entry = cacheRef.current.get(pageNumber);
        if (entry?.taskId === taskId && !entry.settled) {
          metrics.recordRenderSettle({
            docId,
            pageNumber,
            taskId,
            genId: startGenId,
            outcome: "completed",
            scale: currentScale,
          });
          markSettled(taskId);
          entry.task = null;
          entry.settled = true;
          setSlots((prev) =>
            prev.map((s) =>
              s.pageNumber === pageNumber ? { ...s, rendered: true } : s
            )
          );
        }
      } catch (err) {
        if (hasSettled(taskId)) {
          return;
        }
        if (isRenderingCancelled(err)) {
          metrics.recordRenderSettle({
            docId,
            pageNumber,
            taskId,
            genId: startGenId,
            outcome: "cancelled",
          });
        } else {
          metrics.recordRenderSettle({
            docId,
            pageNumber,
            taskId,
            genId: startGenId,
            outcome: "failed",
          });
          // Failed (non-cancel) renders: dispose page resources safely.
          const entry = cacheRef.current.get(pageNumber);
          if (entry?.taskId === taskId) {
            try {
              entry.page.cleanup();
            } catch {
              // ignore
            }
            if (entry.canvas) {
              zeroCanvasBacking(entry.canvas);
            }
            if (docId) {
              metrics.recordPageCleanup({ docId, pageNumber });
            }
            cacheRef.current.delete(pageNumber);
            setLiveCanvasCount(cacheRef.current.size);
          }
        }
        markSettled(taskId);
        const entry = cacheRef.current.get(pageNumber);
        if (entry?.taskId === taskId) {
          entry.task = null;
          entry.settled = true;
        }
      }
    },
    // genId must be a dependency: PdfPageView starts renders via an effect keyed
    // on onRender identity. Zoom/fit gen bumps cancel in-flight work in the gen
    // effect, but active stays true and scale alone is not a reliable re-entry
    // signal under all fit modes. Changing ensureRendered identity on gen commit
    // re-invokes onRender so a higher-gen replacement starts after cancel settles
    // (ordering: start < cancel < cancelled settle < higher-gen start).
    [
      doc,
      docId,
      numPages,
      genId,
      devicePixelRatio,
      metrics,
      cancelAndCleanup,
      claimCancelInFlight,
      hasSettled,
      markSettled,
      computeEffectiveScale,
      isRenderingCancelled,
    ]
  );

  /**
   * Flush the pending set. Captures the epoch it was armed under and no-ops when
   * stale; atomically claims the map (copy, then clear) before iterating; and
   * processes entries sequentially so ceiling eviction cannot race.
   */
  const flushPending = useCallback(
    async (armedEpochSeq: number): Promise<void> => {
      pendingTimerRef.current = null;
      if (disposedRef.current || epochSeqRef.current !== armedEpochSeq) {
        return;
      }
      const claimed = [...pendingRef.current.values()];
      pendingRef.current.clear();
      for (const entry of claimed) {
        if (disposedRef.current || epochSeqRef.current !== armedEpochSeq) {
          return;
        }
        if (entry.docId !== docId || entry.genId !== genIdRef.current) {
          continue;
        }
        const active = computeActiveSet(visibleRef.current, numPages);
        if (!active.has(entry.pageNumber)) {
          continue;
        }
        if (
          canvasRef.current.get(entry.pageNumber) !== entry.canvas ||
          !entry.canvas.isConnected
        ) {
          continue;
        }
        const cached = cacheRef.current.get(entry.pageNumber);
        if (
          cached?.task &&
          !cached.settled &&
          cached.startGenId === genIdRef.current
        ) {
          continue;
        }
        await startRenderAdmitted(
          entry.pageNumber,
          entry.canvas,
          armedEpochSeq
        );
      }
    },
    [docId, numPages, startRenderAdmitted]
  );

  flushPendingRef.current = flushPending;

  /**
   * Guards + admission decision. Admission is decided synchronously at entry,
   * before any await, and carries an `epochSeq` token.
   */
  const ensureRendered = useCallback(
    async (pageNumber: number, canvas: HTMLCanvasElement | null) => {
      if (
        !doc ||
        !docId ||
        !canvas ||
        pageNumber < 1 ||
        pageNumber > numPages ||
        disposedRef.current
      ) {
        return;
      }

      // Only pages in the live window (visible ± overscan) may render.
      const active = computeActiveSet(visibleRef.current, numPages);
      if (!active.has(pageNumber)) {
        canvasRef.current.delete(pageNumber);
        return;
      }
      canvasRef.current.set(pageNumber, canvas);

      const admittedEpochSeq = epochSeqRef.current;
      if (epochBatchOpenRef.current) {
        epochAdmittedRef.current += 1;
        await startRenderAdmitted(pageNumber, canvas, admittedEpochSeq);
        return;
      }

      // Deferred: schedule, and emit no metric event unless later admitted.
      pendingRef.current.set(pageNumber, {
        docId,
        genId: genIdRef.current,
        epochSeq: admittedEpochSeq,
        pageNumber,
        canvas,
      });
      // Arm once per pending batch. The quiescence being waited on is that of
      // the VISIBLE SET (the observer re-arms below on genuine churn); resetting
      // the timer on every ensureRendered call would let a component that
      // re-invokes it starve the flush indefinitely.
      if (pendingTimerRef.current === null) {
        pendingTimerRef.current = setTimeout(() => {
          void flushPending(admittedEpochSeq);
        }, SCROLL_QUIESCENCE_MS);
      }
    },
    [doc, docId, numPages, startRenderAdmitted, flushPending]
  );

  const disposeAll = useCallback(async (): Promise<void> => {
    clearPending();
    if (disposePromiseRef.current) {
      await disposePromiseRef.current;
      return;
    }
    disposePromiseRef.current = (async () => {
      disposedRef.current = true;
      const pages = [...cacheRef.current.keys()];
      await Promise.all(pages.map((p) => cancelAndCleanup(p)));
      canvasRef.current.clear();
      setLiveCanvasCount(0);
    })();
    try {
      await disposePromiseRef.current;
    } finally {
      disposePromiseRef.current = null;
      // Allow re-use if doc is remounted with same hook instance.
      disposedRef.current = false;
    }
  }, [cancelAndCleanup, clearPending]);

  // Trigger disposal on unmount / doc change (does not await — use disposeAll).
  useEffect(() => {
    return () => {
      void disposeAll();
    };
  }, [doc, disposeAll]);

  return {
    slots,
    liveCanvasCount,
    observePage,
    ensureRendered,
    scale,
    disposeAll,
  };
}
