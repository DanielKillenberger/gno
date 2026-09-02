/**
 * Single pdfjs-dist import facade for the GNO native PDF viewer.
 * Runtime and type imports of pdfjs-dist are allowed ONLY in this module.
 */

import "./math-sum-precise";
import {
  getDocument as pdfjsGetDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
  type PageViewport,
} from "pdfjs-dist";

// ── Worker / asset bootstrap ────────────────────────────────────────────────
//
// Browser (and Electrobun webview) production: same-origin /vendor/pdfjs/* routes.
// Bun/Node unit tests: resolve assets from the installed pdfjs-dist package so
// real getDocument loads succeed without a running gno serve. Detection uses
// `typeof Bun` — never present in real browser bundles — so browser CSP/offline
// invariants stay intact.

function useLocalPdfjsPackageAssets(): boolean {
  return typeof Bun !== "undefined";
}

function packageSiblingDirUrl(sampleSpecifier: string): string {
  // import.meta.resolve returns a file:// URL in Bun; strip the filename.
  const resolved = import.meta.resolve(sampleSpecifier);
  return resolved.replace(/[^/]+$/u, "");
}

const BROWSER_WORKER_SRC = "/vendor/pdfjs/pdf.worker.min.mjs";
const BROWSER_CMAP_URL = "/vendor/pdfjs/cmaps/";
const BROWSER_STANDARD_FONT_URL = "/vendor/pdfjs/standard_fonts/";

function resolveWorkerSrc(): string {
  if (!useLocalPdfjsPackageAssets()) {
    return BROWSER_WORKER_SRC;
  }
  try {
    return import.meta.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  } catch {
    return BROWSER_WORKER_SRC;
  }
}

function resolveCMapUrl(): string {
  if (!useLocalPdfjsPackageAssets()) {
    return BROWSER_CMAP_URL;
  }
  try {
    return packageSiblingDirUrl("pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap");
  } catch {
    return BROWSER_CMAP_URL;
  }
}

function resolveStandardFontDataUrl(): string {
  if (!useLocalPdfjsPackageAssets()) {
    return BROWSER_STANDARD_FONT_URL;
  }
  try {
    return packageSiblingDirUrl(
      "pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"
    );
  } catch {
    return BROWSER_STANDARD_FONT_URL;
  }
}

/** Same-origin worker in browsers; package-local worker under Bun tests. */
GlobalWorkerOptions.workerSrc = resolveWorkerSrc();

const CMAP_URL = resolveCMapUrl();
const STANDARD_FONT_DATA_URL = resolveStandardFontDataUrl();

// ── Public types ────────────────────────────────────────────────────────────

export type PdfFallbackReason =
  | "corrupt"
  | "password"
  | "network"
  | "bootstrap";

/**
 * Compatible render-params shape for page.render().
 * Not re-exported from the pdfjs-dist package root in v5.7.x — defined here so
 * downstream modules never import pdfjs-dist directly for this type.
 */
export type RenderParameters = {
  canvasContext: CanvasRenderingContext2D;
  viewport: PageViewport;
  canvas?: HTMLCanvasElement | null;
  intent?: string;
  background?: string | CanvasGradient | CanvasPattern | null;
  transform?: number[] | null;
};

export type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  PageViewport,
  PDFDocumentLoadingTask,
};

export { TextLayer };

// Annotation shape used by the link layer (subset of pdfjs annotation dict).
export type PdfAnnotation = {
  subtype?: string;
  annotationType?: number;
  url?: string;
  unsafeUrl?: string;
  dest?: unknown;
  rect?: [number, number, number, number];
  newWindow?: boolean;
};

// ── Document load wrapper ───────────────────────────────────────────────────

/**
 * Transport tier for one document load (fn-136 R1).
 * - `whole-file`: one GET, ranges disabled, body streamed as it arrives.
 * - `ranged`: Range requests of PDF_RANGE_CHUNK_BYTES with background fetch.
 */
export type PdfTransportHint = "whole-file" | "ranged";

export type GnoGetDocumentParams = {
  url: string;
  /** Omitted → `ranged`, the bounded-memory ceiling. */
  transport?: PdfTransportHint;
  // Intentionally NO caller-controlled document id — every load mints a fresh
  // opaque instance id internally (I2-6 / Sol rereview).
};

/** pdf.js DocumentInitParameters subset that the transport tier controls. */
export type PdfTransportOptions = {
  disableRange?: boolean;
  rangeChunkSize?: number;
  disableStream: boolean;
  disableAutoFetch: boolean;
};

/**
 * Map a transport hint to pdf.js transport options.
 *
 * whole-file: with `disableStream: true` pdf.js cancels the full-body reader
 * as soon as the server advertises byte ranges, so the single-request tier
 * must disable ranges explicitly or its first GET is thrown away.
 *
 * ranged: `disableStream: true` keeps the full-body GET from competing with
 * Range requests; `disableAutoFetch: false` lets pdf.js pull the remaining
 * chunks in the background instead of one round trip per parser miss. Range
 * eligibility still needs Content-Length > 2×rangeChunkSize plus
 * Accept-Ranges: bytes (emitted by GET /api/doc-asset).
 */
export function transportOptionsFor(
  hint: PdfTransportHint
): PdfTransportOptions {
  if (hint === "whole-file") {
    return {
      disableRange: true,
      disableStream: false,
      disableAutoFetch: false,
    };
  }
  return {
    rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
    disableStream: true,
    disableAutoFetch: false,
  };
}

/**
 * Pick the transport tier from a HEAD-probed Content-Length.
 * Unknown (null / non-finite / negative) sizes fall back to `ranged`.
 */
export function transportHintForContentLength(
  contentLength: number | null
): PdfTransportHint {
  if (
    contentLength === null ||
    !Number.isFinite(contentLength) ||
    contentLength < 0
  ) {
    return "ranged";
  }
  return contentLength < PDF_WHOLE_FILE_MAX_BYTES ? "whole-file" : "ranged";
}

/**
 * Loading task augmented with the opaque per-load document instance id.
 * `gnoDocId` is never derived from URL/path/URI/filename/title/content and is
 * never caller-supplied.
 */
export type GnoDocumentLoadingTask = PDFDocumentLoadingTask & {
  readonly gnoDocId: string;
};

/**
 * Create a pdfjs loading task and always mint a distinct opaque doc instance id.
 * Two calls for the same URL always get different gnoDocId values.
 */
/**
 * `globalThis.pdfjsWorker` is a single process-wide slot that every pdfjs-dist
 * copy reads when setting up a fake (non-Worker) worker. Whichever copy imports
 * its worker first wins for all of them — so a transitive dependency's older
 * pdfjs-dist (e.g. `pdf-parse`'s 5.4.x) can install a worker that our pinned
 * API then rejects with "API version does not match the Worker version".
 *
 * Clearing the slot before each load makes pdf.js import *our* `workerSrc`, so
 * the worker always matches this module's API. The dynamic import is module
 * cached, so this costs nothing after the first load. Guarded to the Bun path:
 * browsers use a real Worker and never populate this global.
 */
function releaseForeignFakeWorkerGlobal(): void {
  if (!useLocalPdfjsPackageAssets()) {
    return;
  }
  const g = globalThis as { pdfjsWorker?: unknown };
  if (g.pdfjsWorker !== undefined) {
    g.pdfjsWorker = undefined;
  }
}

export function getDocument(
  params: GnoGetDocumentParams
): GnoDocumentLoadingTask {
  releaseForeignFakeWorkerGlobal();
  // Always mint — no override path exists on the public API.
  const gnoDocId = getPdfMetrics().mintDocId();
  const loadingTask = pdfjsGetDocument({
    url: params.url,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    // Browser default useSystemFonts=true substitutes OS Helvetica and never
    // hits standardFontDataUrl, breaking the offline standard-font contract.
    // Force pdfjs-dist standard_fonts/* over same-origin routes instead.
    useSystemFonts: false,
    // Transport tier by file size (fn-136 R1); see transportOptionsFor.
    ...transportOptionsFor(params.transport ?? "ranged"),
    // Never enable embedded PDF scripting.
    // enableScripting is intentionally omitted (defaults false).
    // pdfjs v5 removed the former eval-support flag; CSP enforces no unsafe-eval.
  }) as GnoDocumentLoadingTask;
  let rejectPassword!: (error: Error) => void;
  const passwordFailure = new Promise<PDFDocumentProxy>((_resolve, reject) => {
    rejectPassword = reject;
  });
  const productPromise = Promise.race([loadingTask.promise, passwordFailure]);
  // PDFDocumentLoadingTask exposes promise as a prototype getter. Shadow it on
  // this facade-owned instance so GNO can model password cancellation without
  // reaching into pdf.js's private capability fields.
  Object.defineProperty(loadingTask, "promise", {
    value: productPromise,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  // GNO does not collect PDF passwords. Without an onPassword callback pdf.js
  // intentionally leaves loadingTask.promise pending forever while it waits for
  // UI input. Reject the facade promise so the existing password state/fallback
  // renders deterministically; usePdfDocument then destroys the waiting task.
  loadingTask.onPassword = (
    updatePassword: (password: string | Error) => void,
    reason: number
  ): void => {
    const error = new Error(
      `Password-protected PDF requires an external reader (${reason || PasswordResponses.NEED_PASSWORD})`
    );
    error.name = "PasswordException";
    updatePassword(error);
    rejectPassword(error);
  };
  Object.defineProperty(loadingTask, "gnoDocId", {
    value: gnoDocId,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  return loadingTask;
}

// ── Error classification ────────────────────────────────────────────────────

function errorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err == null) {
    return "";
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown error";
  }
}

/**
 * Classify a document-load rejection.
 * `"bootstrap"` is only for worker startup / document-load bootstrap failures.
 * Auxiliary cMap/standard-font 404s do not necessarily reject getDocument.
 */
export function classifyPdfError(err: unknown): PdfFallbackReason {
  const name = errorName(err);
  const msg = errorMessage(err).toLowerCase();

  if (
    name === "PasswordException" ||
    msg.includes("password") ||
    msg.includes("needpassword")
  ) {
    return "password";
  }

  if (
    name === "InvalidPDFException" ||
    msg.includes("invalid pdf") ||
    msg.includes("invalidpdf") ||
    msg.includes("missing pdf") ||
    msg.includes("corrupted")
  ) {
    return "corrupt";
  }

  // Worker bootstrap / missing worker / module worker failure
  if (
    msg.includes("worker") ||
    msg.includes("setting up fake worker") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("pdf.worker") ||
    msg.includes("cannot load") ||
    (name === "UnknownErrorException" && msg.includes("worker"))
  ) {
    return "bootstrap";
  }

  // Network / HTTP errors from doc-asset fetch
  if (
    name === "ResponseException" ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("failed to fetch") ||
    msg.includes("http status") ||
    msg.includes("status code") ||
    /\b(4\d\d|5\d\d)\b/.test(msg)
  ) {
    return "network";
  }

  // Default: treat unknown load failures as corrupt for actionable UI
  if (name === "InvalidPDFException") {
    return "corrupt";
  }

  // Missing worker often surfaces as generic Error after 404
  if (msg.includes("unexpected server response") || msg.includes("404")) {
    return "network";
  }

  return "corrupt";
}

export function isRenderingCancelled(err: unknown): boolean {
  const name = errorName(err);
  if (name === "RenderingCancelledException") {
    return true;
  }
  const msg = errorMessage(err).toLowerCase();
  return msg.includes("rendering cancelled") || msg.includes("cancelled");
}

// ── Transport tier constants (fn-136 R1) ────────────────────────────────────

/** Files whose HEAD Content-Length is under this load in one GET. */
export const PDF_WHOLE_FILE_MAX_BYTES = 8 * 1024 * 1024;
/** Range chunk size for files at or above the whole-file bound. */
export const PDF_RANGE_CHUNK_BYTES = 1024 * 1024;

// ── Zoom / fit / canvas cap math ────────────────────────────────────────────

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;
/** Cap device pixel ratio contribution (pdfjs does not do this for us). */
export const MAX_DEVICE_PIXEL_RATIO = 2;
/**
 * Max canvas pixel area (width*height). Guard against 8K-wide pages.
 * ~16 megapixels is a safe desktop bound.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return DEFAULT_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = zoom + direction * ZOOM_STEP;
  // Snap to 1 decimal place to avoid float drift
  return clampZoom(Math.round(next * 100) / 100);
}

export type ViewportDims = { width: number; height: number };
export type ContainerDims = { width: number; height: number };

/** Scale so page width fits the container (rotation-aware via viewport dims). */
export function fitWidthScale(
  viewport: ViewportDims,
  container: ContainerDims,
  baseScale = 1
): number {
  if (viewport.width <= 0 || container.width <= 0) {
    return DEFAULT_ZOOM;
  }
  const atBase = viewport.width / baseScale;
  return clampZoom(container.width / atBase);
}

/** Scale so the whole page fits in the container. */
export function fitPageScale(
  viewport: ViewportDims,
  container: ContainerDims,
  baseScale = 1
): number {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return DEFAULT_ZOOM;
  }
  const atBaseW = viewport.width / baseScale;
  const atBaseH = viewport.height / baseScale;
  const sx = container.width / atBaseW;
  const sy = container.height / atBaseH;
  return clampZoom(Math.min(sx, sy));
}

export type EffectiveScaleInput = {
  zoom: number;
  devicePixelRatio: number;
  /** CSS-pixel page width at the logical zoom (viewport.width). */
  cssWidth: number;
  /** CSS-pixel page height at the logical zoom (viewport.height). */
  cssHeight: number;
  maxCanvasPixels?: number;
  maxDevicePixelRatio?: number;
};

export type EffectiveScaleResult = {
  /** Scale passed to pdfjs render (includes DPR and area clamp). */
  renderScale: number;
  /** Logical CSS scale (zoom only). */
  cssScale: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
};

/**
 * Effective render scale = min(dpr, 2) * zoom, then area-clamped so
 * canvasWidth * canvasHeight <= maxCanvasPixels.
 */
export function computeEffectiveScale(
  input: EffectiveScaleInput
): EffectiveScaleResult {
  const zoom = clampZoom(input.zoom);
  const maxDpr = input.maxDevicePixelRatio ?? MAX_DEVICE_PIXEL_RATIO;
  const maxPixels = input.maxCanvasPixels ?? MAX_CANVAS_PIXELS;
  const dpr = Math.min(Math.max(input.devicePixelRatio || 1, 1), maxDpr);

  let renderScale = zoom * dpr;
  let canvasWidth = Math.max(
    1,
    Math.floor(
      input.cssWidth * (dpr / (input.zoom > 0 ? input.zoom / zoom : 1))
    )
  );
  // Prefer deriving from css dims at logical zoom:
  // cssWidth/cssHeight are already at `zoom` scale from getViewport({scale: zoom}).
  canvasWidth = Math.max(1, Math.floor(input.cssWidth * (renderScale / zoom)));
  let canvasHeight = Math.max(
    1,
    Math.floor(input.cssHeight * (renderScale / zoom))
  );

  const area = canvasWidth * canvasHeight;
  if (area > maxPixels) {
    const factor = Math.sqrt(maxPixels / area);
    renderScale = renderScale * factor;
    canvasWidth = Math.max(
      1,
      Math.floor(input.cssWidth * (renderScale / zoom))
    );
    canvasHeight = Math.max(
      1,
      Math.floor(input.cssHeight * (renderScale / zoom))
    );
  }

  return {
    renderScale,
    cssScale: zoom,
    canvasWidth,
    canvasHeight,
    dpr,
  };
}

// ── Link annotation sanitizer ───────────────────────────────────────────────

/**
 * Allowlist external annotation URLs to http(s) only.
 * Returns null for javascript:, file:, data:, relative, or empty.
 */
export function sanitizeAnnotationUrl(url: string): string | null {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  try {
    // Absolute URLs only — relative schemes rejected
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Metrics channel (__gnoPdfMetrics) ───────────────────────────────────────

export type PdfMetricKind =
  | "renderStart"
  | "renderCancel"
  | "renderSettle"
  | "pageCleanup"
  | "documentDestroy";

export type PdfMetricOutcome = "completed" | "cancelled" | "failed";

export type PdfMetricEvent = {
  seq: number;
  t: number;
  docId: string;
  pageNumber: number | null;
  taskId: string | null;
  genId: number | null;
  kind: PdfMetricKind;
  outcome: PdfMetricOutcome | null;
  scale: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
};

export type PdfMetricsSnapshotMeta = {
  capacity: number;
  dropped: number;
  seqHigh: number;
  t0Epoch: number;
};

export type PdfMetricsSnapshot = PdfMetricsSnapshotMeta & {
  events: readonly PdfMetricEvent[];
};

const DEFAULT_METRICS_CAPACITY = 2000;

type MetricsState = {
  capacity: number;
  dropped: number;
  seq: number;
  t0Epoch: number;
  t0Perf: number;
  events: PdfMetricEvent[];
  docCounter: number;
  taskCounter: number;
  genByDoc: Map<string, number>;
};

function nowPerf(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

function createMetricsState(capacity = DEFAULT_METRICS_CAPACITY): MetricsState {
  return {
    capacity: Math.max(1, capacity),
    dropped: 0,
    seq: 0,
    t0Epoch: Date.now(),
    t0Perf: nowPerf(),
    events: [],
    docCounter: 0,
    taskCounter: 0,
    genByDoc: new Map(),
  };
}

function pushEvent(
  state: MetricsState,
  partial: Omit<PdfMetricEvent, "seq" | "t">
): PdfMetricEvent {
  state.seq += 1;
  // Spec: t is the direct monotonic performance.now() reading (ms).
  // t0Epoch (wall clock at channel start/reset) + t0Perf enable wall mapping:
  // wall ≈ t0Epoch + (t - t0Perf).
  const event: PdfMetricEvent = {
    seq: state.seq,
    t: nowPerf(),
    ...partial,
  };
  state.events.push(event);
  while (state.events.length > state.capacity) {
    state.events.shift();
    state.dropped += 1;
  }
  return event;
}

export type GnoPdfMetrics = {
  reset: (opts?: { capacity?: number }) => void;
  snapshot: () => PdfMetricsSnapshot;
  export: () => PdfMetricsSnapshot;
  mintDocId: () => string;
  mintTaskId: () => string;
  bumpGen: (docId: string) => number;
  currentGen: (docId: string) => number;
  recordRenderStart: (args: {
    docId: string;
    pageNumber: number;
    taskId: string;
    genId: number;
    scale: number;
    canvasWidth: number;
    canvasHeight: number;
  }) => PdfMetricEvent;
  recordRenderCancel: (args: {
    docId: string;
    pageNumber: number;
    taskId: string;
    genId: number;
  }) => PdfMetricEvent;
  recordRenderSettle: (args: {
    docId: string;
    pageNumber: number;
    taskId: string;
    genId: number;
    outcome: PdfMetricOutcome;
    scale?: number | null;
  }) => PdfMetricEvent;
  recordPageCleanup: (args: {
    docId: string;
    pageNumber: number;
  }) => PdfMetricEvent;
  recordDocumentDestroy: (args: { docId: string }) => PdfMetricEvent;
};

function createMetricsApi(state: MetricsState): GnoPdfMetrics {
  return {
    reset(opts) {
      const nextCap = opts?.capacity ?? state.capacity;
      state.capacity = Math.max(1, nextCap);
      state.dropped = 0;
      state.seq = 0;
      state.t0Epoch = Date.now();
      state.t0Perf = nowPerf();
      state.events = [];
      // Preserve opaque counters across reset so ids stay unique channel-wide
      // within a process; gen map resets with the measurement window.
      state.genByDoc = new Map();
    },
    snapshot() {
      // Deep freeze: container, events array, and each event object.
      // Structural clone so mutations cannot reach the live buffer.
      const events = Object.freeze(
        state.events.map((e) => Object.freeze({ ...e }))
      );
      return Object.freeze({
        capacity: state.capacity,
        dropped: state.dropped,
        seqHigh: state.seq,
        t0Epoch: state.t0Epoch,
        events,
      });
    },
    export() {
      // JSON-serializable structural clone
      return JSON.parse(JSON.stringify(this.snapshot())) as PdfMetricsSnapshot;
    },
    mintDocId() {
      state.docCounter += 1;
      return `d${state.docCounter}`;
    },
    mintTaskId() {
      state.taskCounter += 1;
      return `r${state.taskCounter}`;
    },
    bumpGen(docId: string) {
      const next = (state.genByDoc.get(docId) ?? 0) + 1;
      state.genByDoc.set(docId, next);
      return next;
    },
    currentGen(docId: string) {
      return state.genByDoc.get(docId) ?? 0;
    },
    recordRenderStart(args) {
      return pushEvent(state, {
        docId: args.docId,
        pageNumber: args.pageNumber,
        taskId: args.taskId,
        genId: args.genId,
        kind: "renderStart",
        outcome: null,
        scale: args.scale,
        canvasWidth: args.canvasWidth,
        canvasHeight: args.canvasHeight,
      });
    },
    recordRenderCancel(args) {
      return pushEvent(state, {
        docId: args.docId,
        pageNumber: args.pageNumber,
        taskId: args.taskId,
        genId: args.genId,
        kind: "renderCancel",
        outcome: null,
        scale: null,
        canvasWidth: null,
        canvasHeight: null,
      });
    },
    recordRenderSettle(args) {
      return pushEvent(state, {
        docId: args.docId,
        pageNumber: args.pageNumber,
        taskId: args.taskId,
        genId: args.genId,
        kind: "renderSettle",
        outcome: args.outcome,
        scale: args.scale ?? null,
        canvasWidth: null,
        canvasHeight: null,
      });
    },
    recordPageCleanup(args) {
      return pushEvent(state, {
        docId: args.docId,
        pageNumber: args.pageNumber,
        taskId: null,
        genId: null,
        kind: "pageCleanup",
        outcome: null,
        scale: null,
        canvasWidth: null,
        canvasHeight: null,
      });
    },
    recordDocumentDestroy(args) {
      return pushEvent(state, {
        docId: args.docId,
        pageNumber: null,
        taskId: null,
        genId: null,
        kind: "documentDestroy",
        outcome: null,
        scale: null,
        canvasWidth: null,
        canvasHeight: null,
      });
    },
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __gnoPdfMetrics: GnoPdfMetrics | undefined;
}

const metricsState = createMetricsState();
const metricsApi = createMetricsApi(metricsState);

/** Attach once to globalThis so the channel survives React unmount. */
function attachMetrics(): GnoPdfMetrics {
  const g = globalThis as typeof globalThis & {
    __gnoPdfMetrics?: GnoPdfMetrics;
  };
  if (!g.__gnoPdfMetrics) {
    g.__gnoPdfMetrics = metricsApi;
  }
  return g.__gnoPdfMetrics;
}

export const pdfMetrics: GnoPdfMetrics = attachMetrics();

// Convenience re-export of the channel for hooks
export function getPdfMetrics(): GnoPdfMetrics {
  return attachMetrics();
}
