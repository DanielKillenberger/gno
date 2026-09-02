/**
 * PDF viewer browser smoke (fn-112 task .6) — evidence-first Playwright harness.
 *
 * Run (opt-in, not part of default test:e2e):
 *   bun run test:e2e:install   # once — chromium
 *   bun run test:e2e:pdf
 *   bun run smoke:pdf-viewer   # alias
 *
 * Modes (never mixed in one page context):
 *   CLEAN         — GNO_OFFLINE=1, no route interception; sole zero-non-self claim
 *   INTERCEPTION  — synthetic route holds for states / progressive / metrics / aux 404s
 *
 * Artifacts: .flow/reviews/fn-112-task-6-evidence/
 * Large PDFs and temp installs stay under OS temp and are cleaned up.
 */

// node:fs/promises: temp directory lifecycle has no Bun-native equivalent.
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
} from "playwright";

import { saveConfigToPath } from "../src/config/saver";
import { startBackgroundRuntime } from "../src/serve/background-runtime";
import {
  PDF_RANGE_CHUNK_BYTES,
  PDF_WHOLE_FILE_MAX_BYTES,
} from "../src/serve/public/lib/pdf-transport";

// ── Constants ───────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, "..");
const FIXTURE_DIR = join(ROOT, "test/fixtures/conversion/pdf");
const ARTIFACT_DIR = join(ROOT, ".flow/reviews/fn-112-task-6-evidence");
const LETTER_W = 612;
const LETTER_H = 792;
const LETTER_RATIO = LETTER_W / LETTER_H; // 17/22
const RATIO_TOL = 0.01;
/** Product ranged-tier chunk (1 MiB). pdf.js ranges require length > 2× this. */
const RANGE_CHUNK_SIZE = PDF_RANGE_CHUNK_BYTES;
/** Minimum fixture size for pdf.js range eligibility (exclusive lower bound: 2 × rangeChunkSize). */
const MIN_RANGE_ELIGIBLE_BYTES = 2 * RANGE_CHUNK_SIZE;
/** A fixture at or above this loads ranged; below it loads whole-file with zero Range requests. */
const RANGED_TIER_MIN_BYTES = PDF_WHOLE_FILE_MAX_BYTES;
/** Selection-vs-glyph overlap tolerance in CSS pixels. */
const ALIGN_TOL_PX = 6;
const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_DPR = 2;
const P1_SMALL_MS = 1500;
const P1_LARGE_MS = 3000;
const P3_MAX_STARTS = 60;
const P4A_P95_MS = 500;
const P6_SILENCE_MS = 1000;

const STATE_COPY = {
  loading: {
    testId: "pdf-state-loading",
    body: "Preparing document…",
  },
  empty: {
    testId: "pdf-state-empty",
    body: "This PDF has no pages.",
    eyebrow: "EMPTY DOCUMENT",
  },
  corrupt: {
    testId: "pdf-state-corrupt",
    body: "This PDF could not be rendered. Download the original to read it.",
    eyebrow: "CANNOT RENDER",
  },
  password: {
    testId: "pdf-state-password",
    body: "This PDF is password protected. Download the original to open it in a PDF reader.",
    eyebrow: "PASSWORD PROTECTED",
  },
  network: {
    testId: "pdf-state-network",
    body: "The document could not be loaded from this session. Try again, or download the original.",
    eyebrow: "COULD NOT LOAD",
  },
  bootstrap: {
    testId: "pdf-state-bootstrap",
    body: "The PDF viewer could not start in this window. Download the original to read it.",
    eyebrow: "VIEWER UNAVAILABLE",
  },
} as const;

const FALLBACK_COPY = {
  corrupt: {
    testId: "pdf-fallback-corrupt",
    body: "This PDF could not be rendered. View the extracted text or download the original.",
    eyebrow: "CANNOT RENDER",
  },
  password: {
    testId: "pdf-fallback-password",
    body: "This PDF is password protected. Showing the extracted text instead. Download the original to open it in a PDF reader.",
    eyebrow: "PASSWORD PROTECTED",
  },
  network: {
    testId: "pdf-fallback-network",
    body: "The document could not be loaded from this session. Showing the extracted text instead. Switch to Pages to try again, or download the original.",
    eyebrow: "COULD NOT LOAD",
  },
  bootstrap: {
    testId: "pdf-fallback-bootstrap",
    body: "The PDF viewer could not start in this window. Showing the extracted text instead. Download the original to read it.",
    eyebrow: "VIEWER UNAVAILABLE",
  },
} as const;

// ── Local large fixture (exactly N pages, unrotated Letter) ─────────────────

/**
 * Classic-xref, range-friendly Letter PDF with exactly `pages` pages.
 *
 * Byte layout (critical for progressive Range holds under pdf.js):
 *   1. Catalog + Pages tree + shared font + ALL page dictionaries + page-1
 *      content stream — kept compact and early so the first 64 KiB Range plus
 *      the tail xref are enough to resolve the document and paint page 1.
 *      (pdf.js getPageDict prefetches every toplevel /Kids ref; if page dicts
 *      are interleaved with padded streams, init requests almost every chunk
 *      and progressive hold becomes impossible.)
 *   2. Large padded content streams for pages 2..N (middle of file).
 *   3. xref table + trailer + startxref (tail).
 *
 * With product disableStream/disableAutoFetch, middle content streams stay
 * unrequested until a later page enters the live window — so the smoke can
 * hold ≥1 later Range while page 1 is already data-rendered. MediaBox is
 * exactly [0 0 612 792] on every page.
 */
async function generateLargePdf(
  pages: number,
  outPath?: string
): Promise<Uint8Array> {
  const count = Math.max(1, pages);
  // Object map (ids fixed; emission order is structure-first, streams later):
  //   1 Catalog, 2 Pages, 3 Font
  //   For page i (1-based): pageObj = 2 + 2*i, contentObj = 3 + 2*i
  //   page 1 → 4/5, page 2 → 6/7, … page N → (2+2N)/(3+2N)
  const pageObj = (i: number): number => 2 + 2 * i;
  const contentObj = (i: number): number => 3 + 2 * i;
  const kids = Array.from(
    { length: count },
    (_, i) => `${pageObj(i + 1)} 0 R`
  ).join(" ");

  const byId = new Map<number, string>();
  byId.set(1, "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  byId.set(
    2,
    `2 0 obj<< /Type /Pages /Kids [${kids}] /Count ${count} >>endobj\n`
  );
  byId.set(
    3,
    "3 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
  );

  for (let i = 1; i <= count; i++) {
    const pObj = pageObj(i);
    const cObj = contentObj(i);
    byId.set(
      pObj,
      `${pObj} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER_W} ${LETTER_H}] /Contents ${cObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>endobj\n`
    );

    let content: string;
    if (i === 1) {
      content =
        "BT /F1 18 Tf 50 720 Td (Large fixture page 1 of " +
        String(count) +
        ") Tj 0 -24 Td (MARKER_PAGE_1) Tj 0 -24 Td " +
        "(Deterministic first-page content for range-friendly progressive paint.) Tj ET";
    } else {
      const lines: string[] = [
        `BT /F1 14 Tf 50 720 Td (Large fixture page ${i} of ${count}) Tj`,
        `0 -20 Td (MARKER_PAGE_${i}) Tj`,
      ];
      // Page 2+ streams must NOT fit in the first range chunk remainder after
      // the early structure. Overscan renders page 2 while page 1 is painted;
      // if page-2 content lived inside the first 1 MiB chunk, no later Range
      // would ever be issued and the held-range oracle would be impossible.
      // Page 2 padding (~15,500 lines × ~70 bytes) spills past the 1 MiB
      // range chunk; remaining padded pages bring the file over the 8 MiB
      // whole-file bound so the product loads it on the ranged tier.
      const padLines = i === 2 ? 15_500 : 600;
      for (let j = 0; j < padLines; j++) {
        lines.push(`0 -14 Td (pad p${i} l${j} ${"x".repeat(56)}) Tj`);
      }
      lines.push("ET");
      content = lines.join("\n");
    }
    const contentLen = Buffer.byteLength(content, "utf8");
    byId.set(
      cObj,
      `${cObj} 0 obj<< /Length ${contentLen} >>stream\n${content}\nendstream\nendobj\n`
    );
  }

  // Emission order (not object-id order): structure + all page dicts + page-1
  // content first; every other content stream afterward; classic xref at tail.
  const emissionOrder: number[] = [1, 2, 3];
  for (let i = 1; i <= count; i++) {
    emissionOrder.push(pageObj(i));
  }
  emissionOrder.push(contentObj(1));
  for (let i = 2; i <= count; i++) {
    emissionOrder.push(contentObj(i));
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  const maxId = contentObj(count);
  for (let id = 1; id <= maxId; id++) {
    offsets.push(0);
  }
  for (const id of emissionOrder) {
    const obj = byId.get(id);
    assert(obj, `missing object ${id} in large PDF generator`);
    offsets[id] = Buffer.byteLength(body, "utf8");
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(Buffer.from(body, "utf8"));
  assert(
    bytes.byteLength >= RANGED_TIER_MIN_BYTES,
    `the ranged fixture must reach the whole-file bound (${RANGED_TIER_MIN_BYTES}), got ${bytes.byteLength}`
  );
  // Structure+page-dicts+page1 content must fit the first range chunk so page 1
  // can paint while later content Ranges remain holdable.
  const page1Content = byId.get(contentObj(1)) ?? "";
  const earlyPrefix =
    "%PDF-1.4\n" +
    (byId.get(1) ?? "") +
    (byId.get(2) ?? "") +
    (byId.get(3) ?? "") +
    Array.from(
      { length: count },
      (_, i) => byId.get(pageObj(i + 1)) ?? ""
    ).join("") +
    page1Content;
  const earlyBytes = Buffer.byteLength(earlyPrefix, "utf8");
  assert(
    earlyBytes < RANGE_CHUNK_SIZE,
    `range-friendly early structure must fit in first range chunk (${RANGE_CHUNK_SIZE}), got ${earlyBytes}`
  );
  const page2ContentBytes = Buffer.byteLength(
    byId.get(contentObj(2)) ?? "",
    "utf8"
  );
  assert(
    earlyBytes + page2ContentBytes > RANGE_CHUNK_SIZE,
    "page 2 must spill past the first range chunk"
  );
  if (outPath) {
    await Bun.write(outPath, bytes);
  }
  return bytes;
}

function verifyLetterMediaBox(bytes: Uint8Array): void {
  const text = Buffer.from(bytes).toString("latin1");
  // Fail loudly on MediaBox oracle drift (spec progressive aspect oracle).
  const mediaBoxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/gu)];
  assert(mediaBoxes.length > 0, "large PDF has no /MediaBox entries");
  for (const m of mediaBoxes) {
    const nums = (m[1] ?? "")
      .trim()
      .split(/\s+/u)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    assert(
      nums.length >= 4 &&
        nums[0] === 0 &&
        nums[1] === 0 &&
        nums[2] === LETTER_W &&
        nums[3] === LETTER_H,
      `MediaBox oracle drift: expected [0 0 ${LETTER_W} ${LETTER_H}], got [${nums.join(" ")}]`
    );
  }
  // Count page objects roughly via /Type /Page (not /Pages).
  const pageObjs = (text.match(/\/Type\s*\/Page(?![sA-Za-z])/gu) ?? []).length;
  assert(
    pageObjs === 200,
    `large-200.pdf must be exactly 200 pages, found ~${pageObjs} /Type /Page objects`
  );
}

// ── Evidence / logging ──────────────────────────────────────────────────────

type RequestLogEntry = {
  mode: string;
  url: string;
  method: string;
  status: number | null;
  bodySize: number | null;
  resourceType: string;
  headers?: Record<string, string>;
  ts: number;
};

type ConsoleLogEntry = {
  mode: string;
  type: string;
  text: string;
  ts: number;
};

type Evidence = {
  machine: {
    platform: string;
    arch: string;
    bun: string;
    startedAt: string;
    finishedAt?: string;
  };
  modes: Record<string, unknown>;
  screenshots: string[];
  /** Per-capture record of whether fullPage was used, and the document height. */
  screenshotModes: Array<{
    file: string;
    fullPage: boolean;
    docHeight: number;
  }>;
  failures: string[];
  budgetFailures: string[];
  commands: Array<{ name: string; ok: boolean; detail?: string }>;
  artifactHashes: Record<string, string>;
};

const evidence: Evidence = {
  machine: {
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    startedAt: new Date().toISOString(),
  },
  modes: {},
  screenshots: [],
  screenshotModes: [],
  failures: [],
  budgetFailures: [],
  commands: [],
  artifactHashes: {},
};

const requestLogs: RequestLogEntry[] = [];
const consoleLogs: ConsoleLogEntry[] = [];

function log(msg: string): void {
  console.log(`[pdf-smoke] ${msg}`);
}

function fail(msg: string): never {
  evidence.failures.push(msg);
  throw new Error(msg);
}

/**
 * Record a *budget* miss (P-1..P-6) without aborting the run.
 *
 * The task requires budget failures to be reported with their numbers and never
 * silently relaxed — but aborting on the first miss discards every downstream
 * acceptance artifact. So the threshold is unchanged and the miss is still
 * fatal: main() exits non-zero at the end if any budget failure was recorded.
 */
function budgetFail(msg: string): void {
  evidence.failures.push(msg);
  evidence.budgetFailures.push(msg);
  log(`BUDGET FAILURE: ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    fail(msg);
  }
}

function sha256(buf: ArrayBuffer | Uint8Array | Buffer | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  return hasher.digest("hex");
}

/** Max characters retained per stream for failure reports (bounded). */
const SERVER_LOG_CAP = 64 * 1024;

type ServerLogCapture = {
  stdout: string;
  stderr: string;
  /** Call after kill / on failure to ensure readers settle. */
  drain: () => Promise<void>;
  tail: (maxChars?: number) => { stdout: string; stderr: string };
};

/**
 * Continuously drain a child process's stdout/stderr into bounded strings so
 * (a) the pipe cannot backpressure and hang the child, and (b) wait/health
 * failures can report exit code + log tails instead of silent timeout.
 */
function captureServerLogs(
  proc: ReturnType<typeof Bun.spawn>
): ServerLogCapture {
  let stdout = "";
  let stderr = "";

  const append = (side: "stdout" | "stderr", chunk: string): void => {
    if (side === "stdout") {
      stdout += chunk;
      if (stdout.length > SERVER_LOG_CAP) {
        stdout = stdout.slice(stdout.length - SERVER_LOG_CAP);
      }
    } else {
      stderr += chunk;
      if (stderr.length > SERVER_LOG_CAP) {
        stderr = stderr.slice(stderr.length - SERVER_LOG_CAP);
      }
    }
  };

  // Bun types stdout/stderr as `number | ReadableStream | undefined` because the
  // shape depends on the spawn options; we always pass "pipe", so narrow here.
  const readStream = async (
    stream: unknown,
    side: "stdout" | "stderr"
  ): Promise<void> => {
    if (!(stream instanceof ReadableStream)) {
      return;
    }
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          append(side, decoder.decode(value, { stream: true }));
        }
      }
      append(side, decoder.decode());
    } catch {
      // Process killed / stream closed mid-read — keep what we have.
    }
  };

  const stdoutDone = readStream(proc.stdout, "stdout");
  const stderrDone = readStream(proc.stderr, "stderr");

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    drain: async () => {
      await Promise.all([stdoutDone, stderrDone]);
    },
    tail: (maxChars = 4000) => ({
      stdout:
        stdout.length > maxChars
          ? stdout.slice(stdout.length - maxChars)
          : stdout,
      stderr:
        stderr.length > maxChars
          ? stderr.slice(stderr.length - maxChars)
          : stderr,
    }),
  };
}

function formatServerDiag(
  baseUrl: string,
  proc: ReturnType<typeof Bun.spawn>,
  logs: ServerLogCapture,
  reason: string
): string {
  const exitCode =
    proc.exitCode === null || proc.exitCode === undefined
      ? "still-running"
      : String(proc.exitCode);
  const tails = logs.tail(6000);
  return [
    reason,
    `url=${baseUrl}`,
    `pid=${proc.pid}`,
    `exitCode=${exitCode}`,
    "--- server stdout (tail) ---",
    tails.stdout || "(empty)",
    "--- server stderr (tail) ---",
    tails.stderr || "(empty)",
  ].join("\n");
}

async function waitForHealthy(
  baseUrl: string,
  proc: ReturnType<typeof Bun.spawn>,
  logs: ServerLogCapture
): Promise<void> {
  for (let i = 0; i < 150; i++) {
    // Fail early if the child already exited — do not burn the full timeout.
    if (proc.exitCode !== null && proc.exitCode !== undefined) {
      await logs.drain().catch(() => undefined);
      fail(
        formatServerDiag(
          baseUrl,
          proc,
          logs,
          `Server exited before healthy (exit ${proc.exitCode})`
        )
      );
    }
    // Bun exposes exited as a Promise; also check non-blocking race.
    const exitedEarly = await Promise.race([
      proc.exited.then((code) => code as number | null),
      Bun.sleep(0).then(() => null as number | null),
    ]);
    if (exitedEarly !== null) {
      await logs.drain().catch(() => undefined);
      fail(
        formatServerDiag(
          baseUrl,
          proc,
          logs,
          `Server exited before healthy (exit ${exitedEarly})`
        )
      );
    }

    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) {
        return;
      }
    } catch {
      // starting
    }
    await Bun.sleep(100);
  }

  // Final exit check + drain for complete tails on timeout.
  await Promise.race([proc.exited.then(() => undefined), Bun.sleep(50)]).catch(
    () => undefined
  );
  await logs.drain().catch(() => undefined);
  const exitHint =
    proc.exitCode === null || proc.exitCode === undefined
      ? "still running (no response on /api/health)"
      : `exited with code ${proc.exitCode}`;
  fail(
    formatServerDiag(
      baseUrl,
      proc,
      logs,
      `Timed out waiting for health at ${baseUrl} (${exitHint})`
    )
  );
}

function isSelfUrl(url: string, baseOrigin: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "blob:") {
      return true;
    }
    return u.origin === baseOrigin;
  } catch {
    return url.startsWith("data:") || url.startsWith("blob:");
  }
}

function attachLogging(
  page: Page,
  mode: string,
  baseOrigin: string
): { nonSelf: string[] } {
  const nonSelf: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!isSelfUrl(url, baseOrigin)) {
      nonSelf.push(url);
    }
  });
  page.on("response", async (res) => {
    let bodySize: number | null = null;
    try {
      const buf = await res.body();
      bodySize = buf.byteLength;
    } catch {
      bodySize = null;
    }
    requestLogs.push({
      mode,
      url: res.url(),
      method: res.request().method(),
      status: res.status(),
      bodySize,
      resourceType: res.request().resourceType(),
      headers: res.headers(),
      ts: Date.now(),
    });
  });
  page.on("console", (msg) => {
    consoleLogs.push({
      mode,
      type: msg.type(),
      text: msg.text(),
      ts: Date.now(),
    });
  });
  page.on("pageerror", (err) => {
    consoleLogs.push({
      mode,
      type: "pageerror",
      text: err.message,
      ts: Date.now(),
    });
  });
  return { nonSelf };
}

/**
 * Largest document height we will ask Chromium to rasterize in one fullPage
 * capture. The 200-page fixture lays out ~200 page boxes, and a fullPage
 * screenshot of that surface exceeds Chromium's tile memory ("tile memory
 * limits exceeded") and kills the target. A fullPage capture also *scrolls* the
 * document, which would perturb the virtualization window a state assertion was
 * just made against — so for tall documents the viewport capture is both the
 * only survivable option and the more faithful record of "that instant".
 */
const MAX_FULLPAGE_CAPTURE_PX = 20_000;

async function shot(page: Page, name: string, mode: string): Promise<string> {
  const file = join(ARTIFACT_DIR, `${mode}__${name}.png`);
  const docHeight = await page
    .evaluate(
      () =>
        Math.max(
          document.documentElement?.scrollHeight ?? 0,
          document.body?.scrollHeight ?? 0
        ) || 0
    )
    .catch(() => 0);
  const fullPage = docHeight > 0 && docHeight <= MAX_FULLPAGE_CAPTURE_PX;
  await page.screenshot({ path: file, fullPage });
  evidence.screenshots.push(file);
  evidence.screenshotModes.push({ file, fullPage, docHeight });
  return file;
}

/**
 * Screenshot clipped to a document-relative box, so the artifact depicts only
 * the named subject rather than whatever the viewport happened to show.
 */
async function shotClip(
  page: Page,
  name: string,
  mode: string,
  rect?: { x: number; y: number; width: number; height: number }
): Promise<string> {
  const file = join(ARTIFACT_DIR, `${mode}__${name}.png`);
  if (rect && rect.width > 0 && rect.height > 0) {
    await page.screenshot({ path: file, fullPage: true, clip: rect });
  } else {
    await page.screenshot({ path: file });
  }
  evidence.screenshots.push(file);
  evidence.screenshotModes.push({ file, fullPage: true, docHeight: 0 });
  return file;
}

// ── Canvas / open helpers ───────────────────────────────────────────────────

async function canvasNonBlank(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvases: HTMLCanvasElement[] = [];
    for (const root of document.querySelectorAll('[data-rendered="true"]')) {
      const c = root.querySelector("canvas.gno-pdf-canvas");
      if (c instanceof HTMLCanvasElement) {
        canvases.push(c);
      }
    }
    if (canvases.length === 0) {
      for (const c of document.querySelectorAll("canvas.gno-pdf-canvas")) {
        if (c instanceof HTMLCanvasElement && c.width > 8) {
          canvases.push(c);
        }
      }
    }
    for (const canvas of canvases) {
      if (canvas.width < 8 || canvas.height < 8) {
        continue;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        continue;
      }
      try {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let dark = 0;
        const stride = 32 * 4;
        for (let i = 0; i < data.length; i += stride) {
          const a = data[i + 3] ?? 0;
          const r = data[i] ?? 255;
          const g = data[i + 1] ?? 255;
          const b = data[i + 2] ?? 255;
          if (a > 8 && r + g + b < 720) {
            dark += 1;
          }
        }
        if (dark >= 3) {
          return true;
        }
      } catch {
        // SecurityError
      }
    }
    return false;
  });
}

async function pngHasInk(png: Buffer): Promise<boolean> {
  if (png.byteLength < 200) {
    return false;
  }
  let darkish = 0;
  for (let i = 100; i < png.byteLength; i += 64) {
    const b = png[i] ?? 255;
    if (b < 240) {
      darkish += 1;
    }
  }
  return darkish >= 8;
}

async function waitForNonBlankCanvas(
  page: Page,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastDbg = "";
  while (Date.now() < deadline) {
    if (await canvasNonBlank(page)) {
      return;
    }
    try {
      const loc = page
        .locator('[data-rendered="true"] canvas.gno-pdf-canvas')
        .first();
      if ((await loc.count()) > 0) {
        const buf = await loc.screenshot({ type: "png" });
        if (await pngHasInk(Buffer.from(buf))) {
          return;
        }
        lastDbg = `pngBytes=${buf.byteLength}`;
      }
    } catch (e) {
      lastDbg = String(e);
    }
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-rendered="true"] canvas.gno-pdf-canvas'
          ).length > 0,
        null,
        { timeout: 250 }
      )
      .catch(() => undefined);
  }
  const dbg = await page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")].map((c) => ({
      w: (c as HTMLCanvasElement).width,
      h: (c as HTMLCanvasElement).height,
      cls: c.className,
      renderedParent: c
        .closest("[data-rendered]")
        ?.getAttribute("data-rendered"),
    }));
    return {
      cs,
      rendered: document.querySelectorAll('[data-rendered="true"]').length,
      text: document
        .querySelector(".gno-pdf-text-layer")
        ?.textContent?.slice(0, 80),
    };
  });
  fail(
    `canvas remained blank after ${timeoutMs}ms: ${JSON.stringify(dbg)} last=${lastDbg}`
  );
}

async function openPdf(
  page: Page,
  baseUrl: string,
  fileName: string
): Promise<void> {
  const uri = `gno://notes/${fileName}`;
  await page.goto(`${baseUrl}/doc?uri=${encodeURIComponent(uri)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="pdf-viewer"]') ||
        document.querySelector('[data-testid="pdf-viewer-stub"]') ||
        document.querySelector('[data-testid^="pdf-state-"]') ||
        document.querySelector('[data-testid^="pdf-fallback-"]')
      ),
    null,
    { timeout: 60_000 }
  );
}

async function waitForProgressive(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        if (document.querySelector('[data-testid^="pdf-state-"]')) {
          return true;
        }
        if (document.querySelector('[data-testid^="pdf-fallback-"]')) {
          return true;
        }
        const pageRoot = document.querySelector(
          '[data-testid^="pdf-page-"]:not([data-testid="pdf-page-column"])'
        ) as HTMLElement | null;
        if (!pageRoot) {
          return false;
        }
        const canvas = pageRoot.querySelector(
          "canvas.gno-pdf-canvas"
        ) as HTMLCanvasElement | null;
        const textLayer = pageRoot.querySelector(".gno-pdf-text-layer");
        const hasDims =
          (canvas && canvas.width > 8 && canvas.height > 8) ||
          (pageRoot.getBoundingClientRect().width > 8 &&
            pageRoot.getBoundingClientRect().height > 8);
        const hasText = Boolean(
          textLayer?.textContent && textLayer.textContent.trim().length > 0
        );
        const markedRendered =
          pageRoot.getAttribute("data-rendered") === "true";
        return hasDims && (markedRendered || hasText || Boolean(canvas));
      },
      null,
      { timeout: 90_000 }
    );
  } catch (err) {
    const dbg = await page
      .evaluate(() => ({
        url: location.href,
        text: document.body?.innerText?.slice(0, 400),
        states: [...document.querySelectorAll("[data-testid^='pdf-']")].map(
          (el) => el.getAttribute("data-testid")
        ),
      }))
      .catch(() => ({ url: "?", text: "eval-failed", states: [] }));
    fail(
      `waitForProgressive timeout: ${String(err)} dbg=${JSON.stringify(dbg)}`
    );
  }
}

/**
 * P-1: first-canvas-visible after `/doc` content load (spec).
 *
 * Content-load boundary = `[data-testid="pdf-viewer"]` mounted. That node only
 * appears once DocView has finished the document API load and handed the PDF
 * branch an asset URL — navigation, SPA boot, and `/api/doc` are outside the
 * budget. End = first page visibly rendered (`data-rendered="true"`, then
 * non-blank canvas confirmation).
 *
 * An init-script MutationObserver + rAF loop stamps both marks on the page
 * clock so host navigation wait is excluded and paint is not under-counted.
 */
async function ensureP1Observer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type P1Marks = {
      contentLoad: number | null;
      firstPaint: number | null;
    };
    const g = globalThis as unknown as { __gnoP1?: P1Marks };
    g.__gnoP1 = { contentLoad: null, firstPaint: null };
    const tick = (): void => {
      const marks = g.__gnoP1;
      if (!marks) {
        return;
      }
      if (
        marks.contentLoad == null &&
        document.querySelector('[data-testid="pdf-viewer"]')
      ) {
        marks.contentLoad = performance.now();
      }
      if (
        marks.contentLoad != null &&
        marks.firstPaint == null &&
        document.querySelector('[data-rendered="true"]')
      ) {
        marks.firstPaint = performance.now();
      }
    };
    const boot = (): void => {
      if (!document.documentElement) {
        requestAnimationFrame(boot);
        return;
      }
      new MutationObserver(tick).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      const loop = (): void => {
        tick();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    boot();
  });
}

async function measureP1FirstPaint(
  page: Page,
  baseUrl: string,
  fileName: string
): Promise<{ ms: number; contentLoadMark: number; firstPaintMark: number }> {
  const uri = `gno://notes/${fileName}`;
  // Full navigation re-runs the init script with fresh marks.
  await page.goto(`${baseUrl}/doc?uri=${encodeURIComponent(uri)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForFunction(
    () => {
      const g = globalThis as unknown as {
        __gnoP1?: {
          contentLoad: number | null;
          firstPaint: number | null;
        };
      };
      return g.__gnoP1?.contentLoad != null && g.__gnoP1?.firstPaint != null;
    },
    null,
    { timeout: 60_000 }
  );

  await waitForNonBlankCanvas(page, 15_000);

  const marks = await page.evaluate(() => {
    const g = globalThis as unknown as {
      __gnoP1?: {
        contentLoad: number | null;
        firstPaint: number | null;
      };
    };
    return {
      contentLoad: g.__gnoP1?.contentLoad ?? null,
      firstPaint: g.__gnoP1?.firstPaint ?? null,
    };
  });
  assert(
    marks.contentLoad != null && marks.firstPaint != null,
    `P-1 marks missing: ${JSON.stringify(marks)}`
  );
  const ms = marks.firstPaint! - marks.contentLoad!;
  assert(ms >= 0, `P-1 negative duration ${ms}`);
  return {
    ms,
    contentLoadMark: marks.contentLoad!,
    firstPaintMark: marks.firstPaint!,
  };
}

async function waitForState(
  page: Page,
  testId: string,
  timeoutMs = 30_000
): Promise<string> {
  await page.waitForSelector(`[data-testid="${testId}"]`, {
    timeout: timeoutMs,
  });
  const text = await page.locator(`[data-testid="${testId}"]`).innerText();
  return text;
}

async function assertStateCard(
  page: Page,
  key: keyof typeof STATE_COPY,
  mode: string
): Promise<void> {
  const spec = STATE_COPY[key];
  const text = await waitForState(page, spec.testId);
  assert(
    text.includes(spec.body),
    `${key} state body missing: expected "${spec.body}", got ${JSON.stringify(text)}`
  );
  if ("eyebrow" in spec && spec.eyebrow) {
    assert(
      text.includes(spec.eyebrow),
      `${key} state eyebrow missing: expected "${spec.eyebrow}", got ${JSON.stringify(text)}`
    );
  }
  // Actionability: download present on error/empty; retry on corrupt/network/bootstrap
  if (key === "loading") {
    await shot(page, `state-${key}`, mode);
    return;
  }
  const hasDownload = await page
    .locator(
      `[data-testid="${spec.testId}"] [data-testid="pdf-action-download"]`
    )
    .count();
  assert(hasDownload >= 1, `${key}: missing pdf-action-download`);
  if (key === "corrupt" || key === "network" || key === "bootstrap") {
    const hasRetry = await page
      .locator(
        `[data-testid="${spec.testId}"] [data-testid="pdf-action-retry"]`
      )
      .count();
    assert(hasRetry >= 1, `${key}: missing pdf-action-retry`);
  }
  if (key === "password") {
    const hasRetry = await page
      .locator(
        `[data-testid="${spec.testId}"] [data-testid="pdf-action-retry"]`
      )
      .count();
    assert(hasRetry === 0, `${key}: must not show retry`);
  }
  await shot(page, `state-${key}`, mode);
}

async function docHasExtractedText(
  baseUrl: string,
  fileName: string
): Promise<boolean> {
  const uri = `gno://notes/${fileName}`;
  const res = await fetch(`${baseUrl}/api/doc?uri=${encodeURIComponent(uri)}`);
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as {
    contentAvailable?: boolean;
    content?: string | null;
  };
  return (
    data.contentAvailable === true &&
    typeof data.content === "string" &&
    data.content.trim().length > 0
  );
}

/**
 * First fixture whose extracted text is genuinely unavailable, so a PDF state
 * card renders on the Pages branch instead of DocView's Text-branch fallback
 * (`DocView.tsx` `handlePdfFallback` switches views only when text exists).
 * Fails loudly rather than silently degrading a state assertion.
 */
async function pickNoExtractedTextFixture(
  baseUrl: string,
  candidates: readonly string[]
): Promise<string> {
  for (const name of candidates) {
    if (!(await docHasExtractedText(baseUrl, name))) {
      return name;
    }
  }
  return fail(
    `no candidate fixture lacks extracted text (${candidates.join(", ")}) — cannot drive a Pages-branch state card deterministically`
  );
}

/**
 * Scroll the document to the top so the sticky DocView header / sticky PDF
 * toolbar cannot sit over a control Playwright is about to click. Purely a
 * pointer-interception fix — it changes no assertion.
 */
async function scrollWindowTop(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      document.scrollingElement?.scrollTo(0, 0);
      // Inner scroll containers matter too: a scrolled ancestor is what lets a
      // sticky bar overlap an absolutely-positioned control.
      for (const el of document.querySelectorAll("*")) {
        const node = el as HTMLElement;
        if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) {
          node.scrollTop = 0;
        }
      }
    })
    .catch(() => undefined);
}

/**
 * Prove the Pages/Text toggle genuinely works: Pages → Text drops the page
 * column, Text → Pages restores it. Stronger than clicking twice and asserting
 * nothing, which could pass on a dead control.
 */
/**
 * Click the Pages/Text pill at rest.
 *
 * The pill is `position:absolute; top:0.75rem; z-10`, and both the DocView
 * header and the PDF toolbar are `sticky top-0 z-10`. Once any scroll container
 * has been scrolled, a later-in-DOM sticky bar wins the hit test at the pill's
 * coordinates. Resetting every scroll container to the top restores the state a
 * user actually sees. If the pill is still not the topmost element there, that
 * is a real overlap defect and we fail loudly rather than dispatching a
 * synthetic event that would bypass hit-testing.
 */
async function clickPdfPagesTextToggle(page: Page): Promise<void> {
  const hit = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="pdf-pages-text-toggle"]'
    ) as HTMLElement | null;
    if (!el) {
      return { ok: false, covered: "toggle missing from DOM" };
    }
    window.scrollTo(0, 0);
    document.scrollingElement?.scrollTo(0, 0);
    for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight) {
        p.scrollTop = 0;
      }
    }
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return {
      ok: Boolean(top && (top === el || el.contains(top) || top.contains(el))),
      covered: top ? top.outerHTML.slice(0, 160) : "nothing at point",
    };
  });
  assert(
    hit.ok,
    `Pages/Text toggle is not hit-testable at rest — covered by: ${hit.covered}`
  );
  await page.locator('[data-testid="pdf-pages-text-toggle"]').click();
}

async function assertPagesTextToggleWorks(page: Page): Promise<void> {
  await clickPdfPagesTextToggle(page);
  await page.waitForSelector('[data-testid="pdf-page-column"]', {
    state: "detached",
    timeout: 15_000,
  });
  await clickPdfPagesTextToggle(page);
  await page.waitForSelector('[data-testid="pdf-page-column"]', {
    timeout: 15_000,
  });
}

/**
 * Literal auxiliary-asset actionability contract: toolbar controls *respond*,
 * the Pages/Text toggle *works*, and the download/open-original action *works*
 * (resolvable same-origin href that really serves the document). Presence in
 * the DOM is not actionability.
 */
async function assertViewerActionable(
  page: Page,
  baseOrigin: string,
  label: string
): Promise<Record<string, unknown>> {
  // 1. Pages/Text toggle really switches branches.
  await assertPagesTextToggleWorks(page);

  // 2. A toolbar control responds: zoom-in changes the displayed zoom.
  const zoomLabel = page.locator('[data-testid="pdf-toolbar-zoom-level"]');
  const zoomBefore = (await zoomLabel.textContent()) ?? "";
  await scrollWindowTop(page);
  await page.locator('[data-testid="pdf-toolbar-zoom-in"]').click();
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector(
        '[data-testid="pdf-toolbar-zoom-level"]'
      );
      return (el?.textContent ?? "") !== prev;
    },
    zoomBefore,
    { timeout: 10_000 }
  );
  const zoomAfter = (await zoomLabel.textContent()) ?? "";
  assert(
    zoomAfter !== zoomBefore,
    `${label}: toolbar zoom control did not respond (${zoomBefore} → ${zoomAfter})`
  );
  // Restore zoom via the preserved keyboard shortcut — clicking the combobox
  // trigger would only open its listbox.
  await scrollWindowTop(page);
  await page.locator('[data-testid="pdf-viewer"]').press("0");

  // 3. Download / open-original really resolves.
  const href = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="pdf-header-download"], [data-testid="pdf-toolbar-download"]'
    );
    const anchor =
      el?.tagName === "A" ? (el as HTMLAnchorElement) : el?.querySelector("a");
    return anchor?.getAttribute("href") ?? null;
  });
  assert(href, `${label}: download control has no href`);
  const absolute = new URL(href!, baseOrigin).toString();
  assert(
    absolute.startsWith(baseOrigin),
    `${label}: download href is not same-origin: ${absolute}`
  );
  const dl = await fetch(absolute);
  assert(dl.ok, `${label}: download href ${absolute} returned ${dl.status}`);
  const dlBytes = await dl.arrayBuffer();
  assert(
    dlBytes.byteLength > 0,
    `${label}: download href ${absolute} returned an empty body`
  );

  return {
    toggleWorks: true,
    zoomBefore,
    zoomAfter,
    downloadHref: absolute,
    downloadStatus: dl.status,
    downloadBytes: dlBytes.byteLength,
  };
}

async function assertFallbackIfExtracted(
  page: Page,
  baseUrl: string,
  fileName: string,
  reason: keyof typeof FALLBACK_COPY
): Promise<void> {
  const available = await docHasExtractedText(baseUrl, fileName);
  if (!available) {
    log(
      `extracted text unavailable for ${fileName} — skip fallback notice for ${reason}`
    );
    return;
  }
  const spec = FALLBACK_COPY[reason];
  // DocView auto-switches to the Text branch when it classifies a fallback on a
  // doc that has extracted text, so the notice is usually already mounted.
  // Only click the toggle when it is not — clicking while it *is* showing would
  // return to Pages and clear the reason.
  const toggle = page.locator('[data-testid="pdf-pages-text-toggle"]');
  const alreadyShowing =
    (await page.locator(`[data-testid="${spec.testId}"]`).count()) > 0;
  if (!alreadyShowing && (await toggle.count()) > 0) {
    await scrollWindowTop(page);
    await toggle.click();
  }
  await page.waitForSelector(`[data-testid="${spec.testId}"]`, {
    timeout: 15_000,
  });
  const text = await page.locator(`[data-testid="${spec.testId}"]`).innerText();
  assert(
    text.includes(spec.body),
    `fallback ${reason} body: ${JSON.stringify(text)}`
  );
  assert(
    text.includes(spec.eyebrow),
    `fallback ${reason} eyebrow: ${JSON.stringify(text)}`
  );
  // Switch back to Pages for subsequent checks
  if ((await toggle.count()) > 0) {
    await scrollWindowTop(page);
    await toggle.click();
  }
}

// ── Progressive Range controller ────────────────────────────────────────────

type HeldRoute = {
  route: Route;
  range: string | null;
  url: string;
};

function createRangeController(fileBytes: Uint8Array) {
  const total = fileBytes.byteLength;
  const queue: HeldRoute[] = [];
  const controlLog: Array<Record<string, unknown>> = [];
  let queueWaiters: Array<() => void> = [];
  let firstNoRangePassThroughDone = false;

  function notify(): void {
    for (const w of queueWaiters) {
      w();
    }
    queueWaiters = [];
  }

  function nextQueuedRange(): Promise<void> {
    if (queue.length > 0) {
      return Promise.resolve();
    }
    return new Promise((res) => {
      queueWaiters.push(res);
    });
  }

  async function fulfilSlice(
    route: Route,
    start: number,
    end: number
  ): Promise<void> {
    const slice = fileBytes.subarray(start, end + 1);
    await route.fulfill({
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(slice.byteLength),
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
      body: Buffer.from(slice),
    });
  }

  function rangeStartOf(item: HeldRoute): number {
    const m = /bytes=(\d+)-/u.exec(item.range ?? "");
    return m ? Number(m[1]) : 0;
  }

  /**
   * Release one held Range. Prefer lowest start, but when both a low and a
   * high (tail/xref) range are queued, release the tail first so startxref can
   * resolve, then low offsets for page-1 content — middle stays held.
   */
  async function releaseNextRange(): Promise<boolean> {
    if (queue.length === 0) {
      return false;
    }
    // Prefer tail ranges (start near end of file) once, then lowest.
    const tailThreshold = Math.max(0, total - RANGE_CHUNK_SIZE);
    let pick = 0;
    let pickScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < queue.length; i++) {
      const s = rangeStartOf(queue[i]!);
      // Tail ranges score as -1 (highest priority); others score by start.
      const score = s >= tailThreshold ? -1 - (total - s) : s;
      if (score < pickScore) {
        pick = i;
        pickScore = score;
      }
    }
    const item = queue.splice(pick, 1)[0];
    if (!item) {
      return false;
    }
    const header = item.range ?? "";
    const m = /bytes=(\d+)-(\d*)/u.exec(header);
    let start = 0;
    let end = total - 1;
    if (m) {
      start = Number(m[1]);
      end = m[2] ? Number(m[2]) : total - 1;
    }
    end = Math.min(end, total - 1);
    controlLog.push({
      action: "release",
      range: header,
      start,
      end,
      queueDepth: queue.length,
      ts: Date.now(),
    });
    await fulfilSlice(item.route, start, end);
    return true;
  }

  async function releaseAll(): Promise<void> {
    while (queue.length > 0) {
      await releaseNextRange();
    }
  }

  async function handler(route: Route): Promise<void> {
    const req = route.request();
    const range = req.headers()["range"] ?? null;
    controlLog.push({
      action: "request",
      range,
      url: req.url(),
      method: req.method(),
      ts: Date.now(),
    });

    if (req.method() === "HEAD") {
      const response = await route.fetch();
      controlLog.push({
        action: "head-probe-passthrough",
        status: response.status(),
        contentLength: response.headers()["content-length"] ?? null,
        expectedContentLength: String(total),
        ts: Date.now(),
      });
      await route.fulfill({ response });
      return;
    }

    if (!range) {
      // Honest pass-through of the Range-less first request: real production
      // endpoint, verbatim response. No truncation, no 206-without-Range, no
      // header rewrite, no synthetic first-64KiB body.
      const response = await route.fetch();
      const status = response.status();
      const headers = response.headers();
      const contentLength = headers["content-length"] ?? null;
      const acceptRanges = headers["accept-ranges"] ?? null;
      controlLog.push({
        action: "first-no-range-passthrough",
        status,
        contentLength,
        acceptRanges,
        total,
        expectedContentLength: String(total),
        truncated: false,
        headerRewrite: false,
        synthetic: false,
        firstNoRange: !firstNoRangePassThroughDone,
        note: "route.fetch() + route.fulfill({response}) verbatim production 200",
      });
      firstNoRangePassThroughDone = true;
      // Assert at fulfil time so a bad production response fails loudly.
      if (status !== 200) {
        throw new Error(
          `progressive first Range-less response must be 200, got ${status}`
        );
      }
      if (contentLength !== String(total)) {
        throw new Error(
          `progressive first Range-less Content-Length must equal fixture total ${total}, got ${contentLength}`
        );
      }
      if ((acceptRanges ?? "").toLowerCase() !== "bytes") {
        throw new Error(
          `progressive first Range-less Accept-Ranges must be bytes, got ${acceptRanges}`
        );
      }
      await route.fulfill({ response });
      return;
    }

    // Later Range requests only: queue and hold for event-driven release.
    queue.push({ route, range, url: req.url() });
    notify();
  }

  return {
    handler,
    nextQueuedRange,
    releaseNextRange,
    releaseAll,
    getQueueDepth: () => queue.length,
    log: controlLog,
    total,
  };
}

// ── Metrics helpers ─────────────────────────────────────────────────────────

type MetricsEvent = {
  seq: number;
  t: number;
  docId: string;
  pageNumber: number | null;
  taskId: string | null;
  genId: number | null;
  kind: string;
  outcome: string | null;
  scale: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
};

type MetricsSnap = {
  events: MetricsEvent[];
  dropped: number;
  capacity: number;
  seqHigh: number;
};

async function ensureMetricsAttached(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(
        (globalThis as unknown as { __gnoPdfMetrics?: unknown }).__gnoPdfMetrics
      ),
    null,
    { timeout: 30_000 }
  );
}

async function metricsReset(page: Page, capacity = 50_000): Promise<void> {
  await ensureMetricsAttached(page);
  await page.evaluate((cap) => {
    const m = (
      globalThis as unknown as {
        __gnoPdfMetrics: { reset: (o: { capacity: number }) => void };
      }
    ).__gnoPdfMetrics;
    m.reset({ capacity: cap });
  }, capacity);
}

async function metricsSnapshot(page: Page): Promise<MetricsSnap> {
  return page.evaluate(() => {
    const m = (
      globalThis as unknown as {
        __gnoPdfMetrics: { snapshot: () => MetricsSnap };
      }
    ).__gnoPdfMetrics;
    return m.snapshot();
  });
}

async function metricsExport(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const m = (
      globalThis as unknown as {
        __gnoPdfMetrics: { export: () => unknown };
      }
    ).__gnoPdfMetrics;
    return m.export();
  });
}

function assertDroppedZero(snap: MetricsSnap, windowName: string): void {
  if (snap.dropped !== 0) {
    fail(
      `${windowName}: metrics dropped=${snap.dropped} (must be 0); capacity=${snap.capacity}`
    );
  }
}

async function waitForVisibleSettled(
  page: Page,
  timeoutMs = 30_000
): Promise<void> {
  await page.waitForFunction(
    () => {
      const m = (
        globalThis as unknown as {
          __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
        }
      ).__gnoPdfMetrics?.snapshot();
      if (!m) {
        return false;
      }
      const starts = m.events.filter((e) => e.kind === "renderStart");
      if (starts.length === 0) {
        return false;
      }
      // Every open start has a terminal settle
      for (const s of starts) {
        const settles = m.events.filter(
          (e) => e.kind === "renderSettle" && e.taskId === s.taskId
        );
        if (settles.length === 0) {
          return false;
        }
      }
      // At least one completed settle
      return m.events.some(
        (e) => e.kind === "renderSettle" && e.outcome === "completed"
      );
    },
    null,
    { timeout: timeoutMs }
  );
}

async function currentDocId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const m = (
      globalThis as unknown as {
        __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
      }
    ).__gnoPdfMetrics?.snapshot();
    if (!m) {
      return null;
    }
    // Prefer latest documentDestroy-less renderStart
    for (let i = m.events.length - 1; i >= 0; i--) {
      const e = m.events[i];
      if (e && (e.kind === "renderStart" || e.kind === "documentDestroy")) {
        if (e.kind === "renderStart") {
          return e.docId;
        }
      }
    }
    const start = m.events.find((e) => e.kind === "renderStart");
    return start?.docId ?? null;
  });
}

/**
 * Commit an exact zoom level through the real zoom-level combobox: one genuine
 * selection → state → genId → render path. No stepped clicks, no state setters,
 * no harness-driven zoom.
 */
async function zoomToPercent(
  page: Page,
  target: 50 | 75 | 100 | 125 | 150 | 200 | 300 | 400
): Promise<void> {
  await openZoomListbox(page);
  await page
    .locator(`[data-testid="pdf-toolbar-zoom-option-${target}"]`)
    .click();
  await page.waitForFunction(
    (pct) => {
      const el = document.querySelector(
        '[data-testid="pdf-toolbar-zoom-level"]'
      );
      return (el?.textContent ?? "").includes(`${pct}%`);
    },
    target,
    { timeout: 10_000 }
  );
}

/**
 * Establish a genuine `custom` fit mode at 100%.
 *
 * A document opens in fit-width, where the toolbar reads 100% while the
 * committed scale is fit-derived (e.g. 1.1437…). Selecting "100%" there is a
 * real no-op — Radix fires no `onValueChange` because the controlled value is
 * already "1". So commit a DIFFERENT stop first (a real gesture that always
 * fires), then commit 100%. Both are genuine selections; afterwards fitMode is
 * `custom` and the committed scale is exactly 1, which is what the P-4 target
 * correlations depend on.
 */
async function establishCustom100(page: Page): Promise<void> {
  await zoomToPercent(page, 150);
  await waitForSettledAtScale(page, 1.5);
  await zoomToPercent(page, 100);
  await waitForSettledAtScale(page, 1);
}

/** Wait until a render at exactly `scale` has reached a completed settle. */
async function waitForSettledAtScale(
  page: Page,
  scale: number,
  timeoutMs = 30_000
): Promise<void> {
  await page.waitForFunction(
    (want) => {
      const m = (
        globalThis as unknown as {
          __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
        }
      ).__gnoPdfMetrics?.snapshot();
      if (!m) {
        return false;
      }
      const starts = m.events.filter(
        (e) =>
          e.kind === "renderStart" &&
          Math.abs((e.scale as number) - want) <= 1e-6
      );
      if (starts.length === 0) {
        return false;
      }
      return starts.some((st) =>
        m.events.some(
          (e) =>
            e.kind === "renderSettle" &&
            e.taskId === st.taskId &&
            e.outcome === "completed"
        )
      );
    },
    scale,
    { timeout: timeoutMs }
  );
}

/** Open the zoom combobox and await its portalled listbox being mounted. */
async function openZoomListbox(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="pdf-toolbar-zoom-level"]');
  await scrollWindowTop(page);
  await trigger.press("Enter");
  await page.waitForSelector('[data-testid="pdf-toolbar-zoom-option-200"]', {
    timeout: 10_000,
  });
}

/**
 * Wait until a text layer is actually populated with the fixture's known glyph
 * run. Without this the alignment measurement can run against an empty text
 * layer and compare two zero-size rects (maxDelta 0, overlapOk false).
 */
async function waitForKnownGlyphText(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const layers = document.querySelectorAll(".gno-pdf-text-layer");
      for (const l of layers) {
        if (!(l.textContent ?? "").includes("KNOWN_GLYPH_RUN_ALPHA")) {
          continue;
        }
        // The marker must sit on a page whose canvas is actually painted, or
        // the alignment comparison has no glyph box to overlap.
        const canvas = l
          .closest(".gno-pdf-page")
          ?.querySelector("canvas.gno-pdf-canvas");
        const r = canvas?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          return true;
        }
      }
      return false;
    },
    null,
    { timeout: 30_000 }
  );
}

async function selectKnownGlyph(page: Page): Promise<{
  selection: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null;
  glyph: { top: number; left: number; width: number; height: number } | null;
  canvas: { top: number; left: number; width: number; height: number } | null;
  pageNumber: string | null;
  overlapOk: boolean;
  maxDelta: number;
}> {
  return page.evaluate((tol) => {
    // Every page of the fixture carries the marker, and page 1's text layer may
    // still be empty while a later page's is populated. Pick the first marker
    // element whose OWN page has a painted (non-zero) canvas, and compare
    // against that same page's canvas — comparing a page-2 selection against
    // page 1's canvas is what previously failed the inCanvas test.
    const pageCanvas = (el: Element | null): HTMLCanvasElement | null => {
      const pageEl = el?.closest(".gno-pdf-page") ?? null;
      return (
        (pageEl?.querySelector(
          "canvas.gno-pdf-canvas"
        ) as HTMLCanvasElement | null) ?? null
      );
    };
    const painted = (c: HTMLCanvasElement | null): boolean => {
      if (!c) {
        return false;
      }
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const spans = Array.from(
      document.querySelectorAll(
        ".gno-pdf-text-layer span, .gno-pdf-text-layer > span, .gno-pdf-text-layer *"
      )
    ) as HTMLElement[];
    const marked = spans.filter((el) =>
      (el.textContent ?? "").includes("KNOWN_GLYPH_RUN_ALPHA")
    );
    const target =
      marked.find((el) => painted(pageCanvas(el))) ?? marked[0] ?? null;
    if (!target) {
      // Fall back: a whole text layer that carries the marker
      const layer = Array.from(
        document.querySelectorAll(".gno-pdf-text-layer")
      ).find((l) => (l.textContent ?? "").includes("KNOWN_GLYPH_RUN_ALPHA")) as
        | HTMLElement
        | undefined;
      if (!layer) {
        return {
          selection: null,
          glyph: null,
          canvas: null,
          pageNumber: null,
          overlapOk: false,
          maxDelta: Infinity,
        };
      }
    }
    const glyphEl =
      target ??
      (Array.from(document.querySelectorAll(".gno-pdf-text-layer")).find((l) =>
        (l.textContent ?? "").includes("KNOWN_GLYPH_RUN_ALPHA")
      ) as HTMLElement);
    const pageNumber =
      glyphEl.closest(".gno-pdf-page")?.getAttribute("data-page-number") ??
      null;
    const gRect = glyphEl.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(glyphEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const sRect = range.getBoundingClientRect();
    const canvas = pageCanvas(glyphEl);
    const cRect = canvas?.getBoundingClientRect() ?? null;

    const selection = {
      top: sRect.top,
      left: sRect.left,
      width: sRect.width,
      height: sRect.height,
    };
    const glyph = {
      top: gRect.top,
      left: gRect.left,
      width: gRect.width,
      height: gRect.height,
    };
    const canvasBox = cRect
      ? {
          top: cRect.top,
          left: cRect.left,
          width: cRect.width,
          height: cRect.height,
        }
      : null;

    // Selection must overlap glyph box within tolerance
    const dx = Math.abs(selection.left - glyph.left);
    const dy = Math.abs(selection.top - glyph.top);
    const dw = Math.abs(selection.width - glyph.width);
    const dh = Math.abs(selection.height - glyph.height);
    const maxDelta = Math.max(dx, dy, dw, dh);
    // Also require selection center inside canvas bounds when canvas present
    let inCanvas = true;
    if (canvasBox) {
      const cx = selection.left + selection.width / 2;
      const cy = selection.top + selection.height / 2;
      inCanvas =
        cx >= canvasBox.left - tol &&
        cx <= canvasBox.left + canvasBox.width + tol &&
        cy >= canvasBox.top - tol &&
        cy <= canvasBox.top + canvasBox.height + tol;
    }
    const overlapOk =
      selection.width > 0 &&
      selection.height > 0 &&
      maxDelta <= tol &&
      Boolean(canvasBox) &&
      (canvasBox?.width ?? 0) > 0 &&
      (canvasBox?.height ?? 0) > 0 &&
      inCanvas;

    return {
      selection,
      glyph,
      canvas: canvasBox,
      pageNumber,
      overlapOk,
      maxDelta,
    };
  }, ALIGN_TOL_PX);
}

function assertSecurityHeaders(
  headers: Record<string, string>,
  label: string
): void {
  const csp =
    headers["content-security-policy"] ??
    headers["Content-Security-Policy"] ??
    "";
  const xfo = headers["x-frame-options"] ?? headers["X-Frame-Options"] ?? "";
  assert(csp.length > 0, `${label}: missing CSP`);
  assert(
    !csp.toLowerCase().includes("unsafe-eval"),
    `${label}: CSP contains unsafe-eval: ${csp}`
  );
  assert(
    csp.includes("frame-ancestors") && csp.includes("'none'"),
    `${label}: CSP missing frame-ancestors 'none': ${csp}`
  );
  assert(
    csp.includes("object-src") && csp.includes("'none'"),
    `${label}: CSP missing object-src 'none': ${csp}`
  );
  assert(
    xfo.toUpperCase() === "DENY",
    `${label}: X-Frame-Options=${xfo} (want DENY)`
  );
}

/**
 * Wait until the console has produced no new output for `quietMs`, bounded by
 * `maxMs`. PDF.js emits auxiliary-asset warnings asynchronously after the page
 * is otherwise idle, so classifying at a fixed moment races them.
 */
async function waitForConsoleQuiet(
  warnings: string[],
  quietMs = 1500,
  maxMs = 12_000
): Promise<void> {
  const deadline = Date.now() + maxMs;
  let lastCount = warnings.length;
  let lastChange = Date.now();
  while (Date.now() < deadline && Date.now() - lastChange < quietMs) {
    await Bun.sleep(100);
    if (warnings.length !== lastCount) {
      lastCount = warnings.length;
      lastChange = Date.now();
    }
  }
}

/**
 * Normalized signature of the PDF.js-relevant console output for an auxiliary
 * asset failure.
 *
 * The determinism requirement is that the *observed outcome* classifies
 * identically across two runs. Hashing the raw console stream instead compares
 * incidental noise — a CSP `base-uri` notice, a transient dev-server 503, and a
 * duplicated font warning all vary run to run while the outcome (font data
 * failed to load; canvas blank; no text) is the same. So: strip volatile
 * origins, keep only pdf.js/asset-relevant lines, dedupe, and sort. The raw
 * warnings are still recorded verbatim in the evidence artifact.
 */
function auxWarningSignature(warnings: string[]): string {
  const relevant = /pdf|font|cmap|bcmap|unable to load|unknownerrorexception/iu;
  return [
    ...new Set(
      warnings
        .map((w) =>
          w
            .replace(/https?:\/\/[^\s'"]+/gu, "<url>")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 120)
        )
        .filter((w) => relevant.test(w))
    ),
  ]
    .sort()
    .join("|");
}

function classifyAuxOutcome(input: {
  warnings: string[];
  textLayer: string;
  nonBlank: boolean;
  pageError: string | null;
}): string {
  if (input.pageError) {
    return `page-error:${input.pageError}`;
  }
  const warnSig = auxWarningSignature(input.warnings);
  if (warnSig) {
    return `warn:${sha256(warnSig).slice(0, 16)}:blank=${input.nonBlank ? 0 : 1}:text=${input.textLayer.length}`;
  }
  return `degraded:blank=${input.nonBlank ? 0 : 1}:text=${input.textLayer.length}`;
}

// ── Artifact cleanup ────────────────────────────────────────────────────────

async function prepareArtifactDir(): Promise<void> {
  // Remove stale artifacts before authoritative run
  try {
    await rm(ARTIFACT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await mkdir(ARTIFACT_DIR, { recursive: true });
}

async function hashArtifacts(): Promise<void> {
  const files = await readdir(ARTIFACT_DIR);
  for (const f of files) {
    const p = join(ARTIFACT_DIR, f);
    const buf = await Bun.file(p).arrayBuffer();
    evidence.artifactHashes[f] = sha256(buf);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await prepareArtifactDir();
  const tempRoot = await mkdtemp(join(tmpdir(), "gno-pdf-viewer-smoke-"));
  const configDir = join(tempRoot, "config");
  const dataDir = join(tempRoot, "data");
  const cacheDir = join(tempRoot, "cache");
  const collectionDir = join(tempRoot, "collection");
  const configPath = join(configDir, "index.yml");
  const indexName = "pdf-viewer-smoke";
  const port = 44_000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const baseOrigin = baseUrl;

  log(`temp=${tempRoot} port=${port} artifacts=${ARTIFACT_DIR}`);

  const fixtures = [
    "viewer-links.pdf",
    "corrupt.pdf",
    "js-action.pdf",
    "password-protected.pdf",
    "standard-font.pdf",
    "cjk-cmap.pdf",
    "zero-page.pdf",
    "sample.pdf",
  ];
  await mkdir(collectionDir, { recursive: true });
  for (const f of fixtures) {
    await Bun.write(join(collectionDir, f), Bun.file(join(FIXTURE_DIR, f)));
  }

  // Companion markdown so the collection is non-empty beyond PDFs
  await Bun.write(
    join(collectionDir, "with-text-meta.md"),
    "# Companion\n\nExtracted text companion for index coverage.\n"
  );

  const largePath = join(tempRoot, "large-200.pdf");
  log("Generating 200-page large fixture…");
  const largeBytes = await generateLargePdf(200, largePath);
  assert(
    largeBytes.byteLength >= RANGED_TIER_MIN_BYTES,
    `large-200.pdf must reach the ranged tier (${RANGED_TIER_MIN_BYTES}), got ${largeBytes.byteLength} bytes (still exactly 200 pages)`
  );
  verifyLetterMediaBox(largeBytes);
  log(
    `large fixture bytes=${largeBytes.byteLength} pages=200 (>=${RANGED_TIER_MIN_BYTES}=ranged tier)`
  );
  await Bun.write(join(collectionDir, "large-200.pdf"), Bun.file(largePath));

  const originalEnv = {
    GNO_CONFIG_DIR: process.env.GNO_CONFIG_DIR,
    GNO_DATA_DIR: process.env.GNO_DATA_DIR,
    GNO_CACHE_DIR: process.env.GNO_CACHE_DIR,
    GNO_OFFLINE: process.env.GNO_OFFLINE,
  };

  process.env.GNO_CONFIG_DIR = configDir;
  process.env.GNO_DATA_DIR = dataDir;
  process.env.GNO_CACHE_DIR = cacheDir;
  process.env.GNO_OFFLINE = "1";

  let server: ReturnType<typeof Bun.spawn> | null = null;
  let serverLogs: ServerLogCapture | null = null;
  let browser: Browser | null = null;

  try {
    const saveResult = await saveConfigToPath(
      {
        version: "1.0",
        ftsTokenizer: "unicode61",
        collections: [
          {
            name: "notes",
            path: collectionDir,
            pattern: "**/*",
            include: [],
            exclude: [],
          },
        ],
        contexts: [],
      },
      configPath
    );
    if (!saveResult.ok) {
      fail(saveResult.error.message);
    }

    log("Indexing collection…");
    const seedRuntime = await startBackgroundRuntime({
      configPath,
      index: indexName,
      offline: true,
    });
    if (!seedRuntime.success) {
      fail(seedRuntime.error);
    }
    try {
      await seedRuntime.runtime.syncAll({ triggerEmbed: false });
    } finally {
      await seedRuntime.runtime.dispose();
    }

    server = Bun.spawn(
      [
        "bun",
        "run",
        "src/index.ts",
        "--config",
        configPath,
        "--index",
        indexName,
        "serve",
        "--port",
        String(port),
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          GNO_CONFIG_DIR: configDir,
          GNO_DATA_DIR: dataDir,
          GNO_CACHE_DIR: cacheDir,
          GNO_OFFLINE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    serverLogs = captureServerLogs(server);

    await waitForHealthy(baseUrl, server, serverLogs);
    log("Server healthy");

    try {
      browser = await chromium.launch({ headless: true });
    } catch (launchErr) {
      const candidates = [
        join(
          process.env.HOME ?? "",
          ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome"
        ),
        join(
          process.env.HOME ?? "",
          ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell"
        ),
      ];
      let launched: Browser | null = null;
      for (const exe of candidates) {
        if (await Bun.file(exe).exists()) {
          log(`chromium.launch fallback executablePath=${exe}`);
          launched = await chromium.launch({
            headless: true,
            executablePath: exe,
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          });
          break;
        }
      }
      if (!launched) {
        throw launchErr;
      }
      browser = launched;
    }

    // ══════════════════════════════════════════════════════════════════════
    // CLEAN MODE — zero-non-self + offline asset behavioral proof
    // ══════════════════════════════════════════════════════════════════════
    {
      const mode = "CLEAN";
      const ctx = await browser.newContext({
        viewport: { width: 1380, height: 900 },
        colorScheme: "dark",
      });
      const page = await ctx.newPage();
      await ensureP1Observer(page);
      const { nonSelf } = attachLogging(page, mode, baseOrigin);
      const clean: Record<string, unknown> = { mode };

      try {
        // Page security headers
        const home = await page.goto(baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const pageHeaders = home?.headers() ?? {};
        clean.pageHeaders = pageHeaders;
        assertSecurityHeaders(pageHeaders, "CLEAN page");

        // ── viewer-links + P-1 small (content-load → first canvas) ─────
        log("CLEAN: viewer-links.pdf (P-1 small)");
        const p1SmallResult = await measureP1FirstPaint(
          page,
          baseUrl,
          "viewer-links.pdf"
        );
        const p1Small = p1SmallResult.ms;
        clean.p1SmallMs = p1Small;
        clean.p1SmallMarks = p1SmallResult;
        if (p1Small > P1_SMALL_MS) {
          budgetFail(
            `P-1 small first paint ${p1Small.toFixed(1)}ms > ${P1_SMALL_MS}ms (boundary: pdf-viewer mount → data-rendered)`
          );
        }
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);

        const pageCount = await page
          .locator('[data-testid="pdf-toolbar-page-indicator"]')
          .textContent();
        clean.viewerLinksPageIndicator = pageCount;
        assert(
          pageCount?.includes("5") || pageCount?.includes("/ 5"),
          `expected 5 pages, got ${pageCount}`
        );

        // Select known glyph run
        const selResult = await selectKnownGlyph(page);
        clean.knownGlyphSelection = selResult;
        assert(
          selResult.glyph !== null,
          "KNOWN_GLYPH_RUN_ALPHA not found in text layer"
        );

        // External link safety
        const linkInfo = await page.evaluate(() => {
          const a = document.querySelector(
            'a[href^="https://"]'
          ) as HTMLAnchorElement | null;
          return a ? { href: a.href, target: a.target, rel: a.rel } : null;
        });
        clean.externalLink = linkInfo;
        assert(linkInfo, "external https link missing");
        assert(
          linkInfo!.target === "_blank",
          `external link target=${linkInfo!.target}`
        );
        assert(
          linkInfo!.rel.includes("noopener") &&
            linkInfo!.rel.includes("noreferrer"),
          `external link rel=${linkInfo!.rel}`
        );

        // Internal jump — event-driven wait for page indicator change
        const beforePage = await page
          .locator('[data-testid="pdf-toolbar-page-indicator"]')
          .textContent();
        await page.evaluate(() => {
          const internal = document.querySelector(
            '.gno-pdf-annotation-link, [data-testid^="pdf-page-"] a'
          ) as HTMLElement | null;
          internal?.click();
        });
        await page
          .waitForFunction(
            (prev) => {
              const ind = document.querySelector(
                '[data-testid="pdf-toolbar-page-indicator"]'
              )?.textContent;
              return Boolean(ind && ind !== prev);
            },
            beforePage,
            { timeout: 5000 }
          )
          .catch(() => undefined);
        clean.internalJump = {
          before: beforePage,
          after: await page
            .locator('[data-testid="pdf-toolbar-page-indicator"]')
            .textContent(),
        };

        // No iframe/object/embed
        const embeds = await page.evaluate(
          () => document.querySelectorAll("iframe, object, embed").length
        );
        assert(embeds === 0, `found ${embeds} iframe/object/embed`);

        await shot(page, "viewer-links-rendered", mode);

        // ── standard-font — require successful standard_fonts fetch ────
        log("CLEAN: standard-font.pdf");
        const fontLogStart = requestLogs.length;
        await openPdf(page, baseUrl, "standard-font.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        await shot(page, "standard-font", mode);
        // Wait until a successful standard_fonts response is observed
        await page
          .waitForFunction(() => true, null, { timeout: 100 })
          .catch(() => undefined);
        // Poll request log via evaluate is unavailable — use host log + short event waits
        {
          const deadline = Date.now() + 15_000;
          while (Date.now() < deadline) {
            const hits = requestLogs.filter(
              (e, i) =>
                i >= fontLogStart &&
                e.mode === mode &&
                e.url.includes("/vendor/pdfjs/standard_fonts/") &&
                e.status === 200 &&
                (e.bodySize ?? 0) > 0
            );
            if (hits.length > 0) {
              break;
            }
            await page
              .waitForEvent("response", {
                predicate: (r) =>
                  r.url().includes("/vendor/pdfjs/standard_fonts/") &&
                  r.status() === 200,
                timeout: 500,
              })
              .catch(() => null);
          }
        }

        // ── cjk-cmap — require successful cmaps .bcmap fetch ───────────
        log("CLEAN: cjk-cmap.pdf");
        const cmapLogStart = requestLogs.length;
        await openPdf(page, baseUrl, "cjk-cmap.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        await shot(page, "cjk-cmap", mode);
        {
          const deadline = Date.now() + 15_000;
          while (Date.now() < deadline) {
            const hits = requestLogs.filter(
              (e, i) =>
                i >= cmapLogStart &&
                e.mode === mode &&
                e.url.includes("/vendor/pdfjs/cmaps/") &&
                e.url.includes(".bcmap") &&
                e.status === 200 &&
                (e.bodySize ?? 0) > 0
            );
            if (hits.length > 0) {
              break;
            }
            await page
              .waitForEvent("response", {
                predicate: (r) =>
                  r.url().includes("/vendor/pdfjs/cmaps/") &&
                  r.url().includes(".bcmap") &&
                  r.status() === 200,
                timeout: 500,
              })
              .catch(() => null);
          }
        }

        const fontHits = requestLogs.filter(
          (e) =>
            e.mode === mode &&
            e.url.includes("/vendor/pdfjs/standard_fonts/") &&
            e.status === 200 &&
            (e.bodySize ?? 0) > 0
        );
        const cmapHits = requestLogs.filter(
          (e) =>
            e.mode === mode &&
            e.url.includes("/vendor/pdfjs/cmaps/") &&
            e.url.includes(".bcmap") &&
            e.status === 200 &&
            (e.bodySize ?? 0) > 0
        );
        const workerHits = requestLogs.filter(
          (e) =>
            e.mode === mode &&
            e.url.includes("/vendor/pdfjs/pdf.worker") &&
            e.status === 200 &&
            (e.bodySize ?? 0) > 0
        );
        clean.standardFontAssets = fontHits.map((h) => ({
          url: h.url,
          bodySize: h.bodySize,
        }));
        clean.cMapAssets = cmapHits.map((h) => ({
          url: h.url,
          bodySize: h.bodySize,
        }));
        clean.workerAssets = workerHits.map((h) => h.url);
        clean.allVendorHits = requestLogs
          .filter((e) => e.mode === mode && e.url.includes("/vendor/pdfjs/"))
          .map((e) => ({
            url: e.url,
            status: e.status,
            bodySize: e.bodySize,
          }));

        assert(
          workerHits.length > 0,
          `no successful same-origin pdf.worker request; vendor=${JSON.stringify(clean.allVendorHits).slice(0, 800)}`
        );
        assert(
          fontHits.length > 0,
          `standard-font.pdf nonblank render MUST consume successful nonempty /vendor/pdfjs/standard_fonts/... ; vendor=${JSON.stringify(clean.allVendorHits).slice(0, 1200)}`
        );
        assert(
          cmapHits.length > 0,
          `cjk-cmap.pdf nonblank render MUST consume successful nonempty /vendor/pdfjs/cmaps/...bcmap ; vendor=${JSON.stringify(clean.allVendorHits).slice(0, 1200)}`
        );

        // Capture clean-run canvas samples for aux 404 delta comparison
        clean.standardFontCanvasInk = true;
        clean.cjkCanvasInk = true;
        const cleanFontText = await page.evaluate(async () => {
          // re-open would wipe — capture cjk text layer now
          return (
            document.querySelector(".gno-pdf-text-layer")?.textContent ?? ""
          );
        });
        clean.cjkTextLayerSample = cleanFontText.slice(0, 200);

        // JS-action inert
        log("CLEAN: js-action.pdf");
        let dialogFired = false;
        page.on("dialog", async (d) => {
          dialogFired = true;
          await d.dismiss();
        });
        await openPdf(page, baseUrl, "js-action.pdf");
        await waitForProgressive(page);
        // Event-driven: wait for viewer settle / no dialog
        await page
          .waitForFunction(
            () =>
              Boolean(
                document.querySelector('[data-testid="pdf-viewer"]') ||
                document.querySelector('[data-testid^="pdf-state-"]')
              ),
            null,
            { timeout: 15_000 }
          )
          .catch(() => undefined);
        // Brief network-idle-ish: wait for no pending pdf requests
        await page
          .waitForLoadState("networkidle", { timeout: 5000 })
          .catch(() => undefined);
        clean.jsActionDialog = dialogFired;
        assert(!dialogFired, "JS action opened a dialog");
        await shot(page, "js-action", mode);

        // Doc-asset security headers
        const assetProbe = await fetch(
          `${baseUrl}/api/doc-asset?uri=${encodeURIComponent("gno://notes/viewer-links.pdf")}&path=${encodeURIComponent("viewer-links.pdf")}`
        );
        const assetHeaders: Record<string, string> = {};
        assetProbe.headers.forEach((v, k) => {
          assetHeaders[k] = v;
        });
        clean.docAssetHeaders = {
          status: assetProbe.status,
          ...assetHeaders,
        };
        await assetProbe.arrayBuffer();
        assert(
          assetProbe.status === 200,
          `doc-asset status ${assetProbe.status}`
        );
        assertSecurityHeaders(assetHeaders, "CLEAN doc-asset");

        // Zero non-self (sole claim for this run)
        clean.nonSelfRequests = nonSelf.slice();
        assert(
          nonSelf.length === 0,
          `CLEAN non-self requests: ${nonSelf.slice(0, 8).join(", ")}`
        );

        log("CLEAN: whole-file tier (sub-bound fixture)");
        const assetRequests: {
          method: string;
          url: string;
          range: string | null;
        }[] = [];
        const onAssetRequest = (req: Request) => {
          if (req.url().includes("/api/doc-asset")) {
            assetRequests.push({
              method: req.method(),
              url: req.url(),
              range: req.headers()["range"] ?? null,
            });
          }
        };
        const logStart = requestLogs.length;
        page.on("request", onAssetRequest);
        await openPdf(page, baseUrl, "sample.pdf");
        await waitForProgressive(page);
        await page
          .waitForLoadState("networkidle", { timeout: 10_000 })
          .catch(() => undefined);
        page.off("request", onAssetRequest);
        const headReqs = assetRequests.filter((r) => r.method === "HEAD");
        const getReqs = assetRequests.filter((r) => r.method === "GET");
        assert(
          headReqs.length === 1,
          `CLEAN whole-file: expected exactly one HEAD, got ${headReqs.length}; ${JSON.stringify(assetRequests)}`
        );
        assert(
          getReqs.length === 1,
          `CLEAN whole-file: expected exactly one GET, got ${getReqs.length}; ${JSON.stringify(assetRequests)}`
        );
        assert(
          getReqs[0]!.range === null,
          `CLEAN whole-file: GET must have no Range, got ${String(getReqs[0]!.range)}`
        );
        assert(
          assetRequests.length === 2,
          `CLEAN whole-file: expected exactly 2 asset requests, got ${assetRequests.length}; ${JSON.stringify(assetRequests)}`
        );
        const getLogs = requestLogs
          .slice(logStart)
          .filter(
            (e) => e.url.includes("/api/doc-asset") && e.method === "GET"
          );
        assert(
          getLogs.length === 1,
          `CLEAN whole-file: expected one GET in requestLogs, got ${getLogs.length}`
        );
        const getStatus = getLogs[0]!.status;
        const getContentLength =
          getLogs[0]!.headers?.["content-length"] ?? null;
        assert(
          getStatus === 200,
          `CLEAN whole-file: GET status ${String(getStatus)}`
        );
        const parsedLen = Number(getContentLength);
        assert(
          Number.isFinite(parsedLen) && parsedLen < RANGED_TIER_MIN_BYTES,
          `CLEAN whole-file: content-length ${String(getContentLength)} must be below ${RANGED_TIER_MIN_BYTES}`
        );
        clean.wholeFileTier = {
          fixture: "sample.pdf",
          requests: assetRequests,
          getStatus,
          getContentLength,
          wholeFileMaxBytes: RANGED_TIER_MIN_BYTES,
        };

        // P-1 large (same content-load → first-canvas boundary)
        log("CLEAN: P-1 large first paint");
        const p1LargeResult = await measureP1FirstPaint(
          page,
          baseUrl,
          "large-200.pdf"
        );
        const p1Large = p1LargeResult.ms;
        clean.p1LargeMs = p1Large;
        clean.p1LargeMarks = p1LargeResult;
        if (p1Large > P1_LARGE_MS) {
          budgetFail(
            `P-1 large first paint ${p1Large.toFixed(1)}ms > ${P1_LARGE_MS}ms (boundary: pdf-viewer mount → data-rendered)`
          );
        }
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page, 20_000);

        evidence.modes.CLEAN = clean;
        evidence.commands.push({ name: "CLEAN", ok: true });
        log(
          `CLEAN complete (P-1 small=${p1Small.toFixed(0)}ms large=${p1Large.toFixed(0)}ms font=${fontHits.length} cmap=${cmapHits.length})`
        );
      } finally {
        await ctx.close();
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // INTERCEPTION MODE
    // ══════════════════════════════════════════════════════════════════════
    {
      const mode = "INTERCEPTION";
      const ctx = await browser.newContext({
        viewport: { width: 1380, height: 900 },
        colorScheme: "dark",
      });
      let page = await ctx.newPage();
      // Interception-mode request logging. Per-run non-self assertions live on
      // the fresh per-attempt pages in the auxiliary blocks.
      attachLogging(page, mode, baseOrigin);
      const inter: Record<string, unknown> = { mode, states: {} };

      try {
        // ── Loading (hold doc-asset) ────────────────────────────────────
        log("INTERCEPTION: loading state");
        let releaseLoading: (() => void) | undefined;
        const loadingGate = new Promise<void>((resolveGate) => {
          releaseLoading = resolveGate;
        });
        await page.route("**/api/doc-asset**", async (route) => {
          if (route.request().url().includes("viewer-links")) {
            await loadingGate;
          }
          await route.continue();
        });
        const loadNav = openPdf(page, baseUrl, "viewer-links.pdf");
        await page.waitForSelector('[data-testid="pdf-state-loading"]', {
          timeout: 15_000,
        });
        await assertStateCard(page, "loading", mode);
        (inter.states as Record<string, unknown>).loading = {
          text: await page
            .locator('[data-testid="pdf-state-loading"]')
            .textContent(),
        };
        // Fix TS2349: releaseLoading is definitely assigned in executor
        const unlock = releaseLoading;
        assert(unlock, "loading gate release missing");
        unlock();
        await loadNav.catch(() => undefined);
        await page
          .unrouteAll({ behavior: "ignoreErrors" })
          .catch(() => undefined);

        // Fresh page for progressive: avoids route/navigation teardown races
        // from the loading hold (Playwright can close the prior page mid-goto).
        await page.close().catch(() => undefined);
        page = await ctx.newPage();
        attachLogging(page, mode, baseOrigin);

        // ── Progressive held-Range ─────────────────────────────────────
        log("INTERCEPTION: progressive held-Range");
        assert(
          largeBytes.byteLength >= RANGED_TIER_MIN_BYTES,
          `progressive: fixture must reach the ranged tier (${RANGED_TIER_MIN_BYTES}), got ${largeBytes.byteLength}`
        );
        const rangeCtl = createRangeController(largeBytes);
        try {
          // Route only the large fixture's doc-asset (task contract).
          await page.route("**/api/doc-asset**", async (route) => {
            const url = route.request().url();
            if (url.includes("large-200")) {
              await rangeCtl.handler(route);
              return;
            }
            await route.continue();
          });

          // Start navigation; release ranges while it loads (must not await
          // goto first — that would deadlock held later ranges).
          const progNavPromise = page.goto(
            `${baseUrl}/doc?uri=${encodeURIComponent("gno://notes/large-200.pdf")}`,
            { waitUntil: "domcontentloaded", timeout: 90_000 }
          );
          void progNavPromise.catch(() => undefined);

          // Wait for honest Range-less pass-through (genuine production 200).
          {
            const firstReqDeadline = Date.now() + 30_000;
            while (
              Date.now() < firstReqDeadline &&
              !rangeCtl.log.some(
                (e) => e.action === "first-no-range-passthrough"
              )
            ) {
              await Promise.race([
                rangeCtl.nextQueuedRange(),
                page
                  .waitForEvent("request", {
                    predicate: (r) => r.url().includes("large-200"),
                    timeout: 500,
                  })
                  .then(() => undefined)
                  .catch(() => undefined),
              ]);
            }
          }
          const firstPass = rangeCtl.log.find(
            (e) => e.action === "first-no-range-passthrough"
          );
          assert(
            firstPass,
            `progressive: missing first-no-range-passthrough; log=${JSON.stringify(rangeCtl.log.slice(0, 10))}`
          );
          assert(
            firstPass.status === 200,
            `progressive: first pass-through status=${String(firstPass.status)}`
          );
          assert(
            firstPass.contentLength === String(largeBytes.byteLength),
            `progressive: first pass-through Content-Length=${String(firstPass.contentLength)} expected ${largeBytes.byteLength}`
          );
          assert(
            String(firstPass.acceptRanges).toLowerCase() === "bytes",
            `progressive: first pass-through Accept-Ranges=${String(firstPass.acceptRanges)}`
          );
          assert(
            firstPass.truncated === false && firstPass.headerRewrite === false,
            "progressive: first pass-through must not truncate or rewrite headers"
          );
          const headPassages = rangeCtl.log.filter(
            (e) => e.action === "head-probe-passthrough"
          );
          assert(
            headPassages.length === 1,
            `progressive: expected exactly one head-probe-passthrough, got ${headPassages.length}; log=${JSON.stringify(rangeCtl.log.slice(0, 10))}`
          );
          const headPass = headPassages[0]!;
          assert(
            headPass.status === 200,
            `progressive: head-probe-passthrough status=${String(headPass.status)}`
          );
          assert(
            headPass.contentLength === String(largeBytes.byteLength),
            `progressive: head-probe-passthrough Content-Length=${String(headPass.contentLength)} expected ${largeBytes.byteLength}`
          );
          const headIdx = rangeCtl.log.findIndex(
            (e) => e.action === "head-probe-passthrough"
          );
          const firstIdx = rangeCtl.log.findIndex(
            (e) => e.action === "first-no-range-passthrough"
          );
          assert(
            headIdx >= 0 && headIdx < firstIdx,
            `progressive: head-probe-passthrough must precede first-no-range-passthrough (head=${headIdx} first=${firstIdx})`
          );

          // Release ONE range at a time until first data-rendered="true".
          // Stop releasing immediately on paint so later Ranges stay held.
          // No fixed acceptance sleeps — only waitForFunction / queue events.
          let painted = false;
          let releases = 0;
          const paintDeadline = Date.now() + 90_000;
          const isPainted = async (): Promise<boolean> =>
            page
              .evaluate(
                () => document.querySelector('[data-rendered="true"]') !== null
              )
              .catch(() => false);
          const waitForPaint = async (timeoutMs: number): Promise<boolean> => {
            await page
              .waitForFunction(
                () => document.querySelector('[data-rendered="true"]') !== null,
                null,
                { timeout: timeoutMs }
              )
              .then(() => undefined)
              .catch(() => undefined);
            return isPainted();
          };

          while (!painted && Date.now() < paintDeadline) {
            if (page.isClosed()) {
              fail(
                `progressive: page closed before first paint; controlLog=${JSON.stringify(rangeCtl.log.slice(0, 40))}`
              );
            }
            painted = await isPainted();
            if (painted) {
              break;
            }

            if (rangeCtl.getQueueDepth() === 0) {
              await Promise.race([
                rangeCtl.nextQueuedRange(),
                waitForPaint(2000),
              ]);
              continue;
            }

            // After start+xref (typically ≥2 releases), structure+page-1 content
            // is available — wait longer for paint before touching middle ranges.
            const preReleaseWait =
              releases >= 2
                ? rangeCtl.getQueueDepth() === 1
                  ? 12_000
                  : 6_000
                : rangeCtl.getQueueDepth() === 1
                  ? 4000
                  : 1500;
            painted = await waitForPaint(preReleaseWait);
            if (painted) {
              break;
            }

            // Never drain the last held range after structural releases until a
            // long paint wait fails — keep ≥1 later Range for the oracle.
            if (releases >= 2 && rangeCtl.getQueueDepth() === 1) {
              painted = await waitForPaint(15_000);
              if (painted) {
                break;
              }
              // Still not painted with one held range: release it as last resort.
            }

            await rangeCtl.releaseNextRange();
            releases += 1;
            painted = await waitForPaint(releases >= 2 ? 4000 : 1500);
          }
          assert(
            painted,
            `progressive: never reached data-rendered=true; controlLog=${JSON.stringify(rangeCtl.log.slice(0, 80))}`
          );

          // Guarantee a held later range; scroll without evicting page 1
          if (rangeCtl.getQueueDepth() < 1) {
            const holdDeadline = Date.now() + 20_000;
            let step = 0;
            while (rangeCtl.getQueueDepth() < 1 && Date.now() < holdDeadline) {
              step += 1;
              await page.evaluate((s) => {
                const col = document.querySelector(
                  '[data-testid="pdf-page-column"]'
                ) as HTMLElement | null;
                if (!col) {
                  return;
                }
                // Keep page 1 in the live window; advance just enough to pull
                // later pending pages into the IntersectionObserver.
                const maxKeepFirst = Math.max(col.clientHeight * 0.85, 300);
                const target = Math.min(
                  maxKeepFirst * s,
                  col.scrollHeight * 0.35,
                  Math.max(0, col.scrollHeight - col.clientHeight)
                );
                col.scrollTop = Math.max(0, target);
              }, step);
              await Promise.race([
                rangeCtl.nextQueuedRange(),
                page
                  .waitForFunction(
                    () =>
                      document.querySelectorAll('[data-rendered="false"]')
                        .length >= 1,
                    null,
                    { timeout: 2500 }
                  )
                  .then(() => undefined)
                  .catch(() => undefined),
              ]);
            }
          }
          if (rangeCtl.getQueueDepth() < 1) {
            await page.evaluate(() => {
              const col = document.querySelector(
                '[data-testid="pdf-page-column"]'
              ) as HTMLElement | null;
              if (col) {
                col.scrollTop = Math.min(
                  col.clientHeight * 2.5,
                  col.scrollHeight * 0.2
                );
              }
            });
            await Promise.race([
              rangeCtl.nextQueuedRange(),
              page
                .waitForEvent("request", {
                  predicate: (r) =>
                    r.url().includes("large-200") &&
                    Boolean(r.headers()["range"]),
                  timeout: 5000,
                })
                .then(() => undefined)
                .catch(() => undefined),
            ]);
          }

          // Single-instant snapshot
          const snap = await page.evaluate((ratioTol) => {
            const col = document.querySelector(
              '[data-testid="pdf-page-column"]'
            );
            const rendered = document.querySelectorAll(
              '[data-rendered="true"]'
            ).length;
            const unrendered = document.querySelectorAll(
              '[data-rendered="false"]'
            ).length;
            const stateCards = document.querySelectorAll(
              '[data-testid^="pdf-state-"]'
            ).length;
            const pending = document.querySelector(
              '[data-rendered="false"]'
            ) as HTMLElement | null;
            const rect = pending?.getBoundingClientRect();
            const pendingInfo = rect
              ? {
                  width: rect.width,
                  height: rect.height,
                  ratio: rect.height > 0 ? rect.width / rect.height : 0,
                }
              : null;
            return {
              hasColumn: Boolean(col),
              rendered,
              unrendered,
              stateCards,
              pending: pendingInfo,
              ratioTol,
            };
          }, RATIO_TOL);

          assert(snap.hasColumn, "progressive: missing pdf-page-column");
          assert(snap.rendered >= 1, "progressive: no rendered page");
          assert(snap.unrendered >= 1, "progressive: no unrendered page");
          assert(snap.stateCards === 0, "progressive: has pdf-state-* card");
          assert(snap.pending, "progressive: no pending rect");
          assert(
            snap.pending!.width > 0 && snap.pending!.height > 0,
            "progressive: zero dims"
          );
          assert(
            Math.abs(snap.pending!.ratio - LETTER_RATIO) <= RATIO_TOL,
            `progressive ratio ${snap.pending!.ratio} not ~${LETTER_RATIO}`
          );
          assert(
            rangeCtl.getQueueDepth() >= 1,
            `progressive: need ≥1 held later range, depth=${rangeCtl.getQueueDepth()}; controlLog=${JSON.stringify(rangeCtl.log.slice(0, 80))}`
          );

          await shot(page, "state-progressive", mode);
          (inter.states as Record<string, unknown>).progressive = {
            ...snap,
            heldRanges: rangeCtl.getQueueDepth(),
            controlLog: rangeCtl.log,
            firstRequest: "honest-passthrough-200",
            laterRangesSyntheticTimingOnly: true,
            evidenceScope:
              "interception: first Range-less response is verbatim production 200; only later Range response *timing* is synthetic — proves progressive rendering contract only; NOT network timing, performance, or zero-non-self",
            mediaBoxOracle: [0, 0, LETTER_W, LETTER_H],
            largeBytes: largeBytes.byteLength,
            minRangeEligibleBytes: MIN_RANGE_ELIGIBLE_BYTES,
            rangeChunkBytes: RANGE_CHUNK_SIZE,
            wholeFileMaxBytes: RANGED_TIER_MIN_BYTES,
            pageCount: 200,
          };
          await Bun.write(
            join(ARTIFACT_DIR, "progressive-control-log.json"),
            JSON.stringify(
              {
                mode,
                firstRequest: "honest-passthrough-200",
                laterRangesSyntheticTimingOnly: true,
                evidenceScope:
                  "first Range-less: route.fetch()+fulfill({response}) verbatim; later Ranges: byte-correct 206 with controlled release timing only — not network timing/performance/zero-non-self",
                log: rangeCtl.log,
                heldAtEvidence: rangeCtl.getQueueDepth(),
                snap,
                fixtureBytes: largeBytes.byteLength,
                minRangeEligibleBytes: MIN_RANGE_ELIGIBLE_BYTES,
                rangeChunkBytes: RANGE_CHUNK_SIZE,
                wholeFileMaxBytes: RANGED_TIER_MIN_BYTES,
              },
              null,
              2
            )
          );
          await progNavPromise.catch(() => undefined);
        } finally {
          // Always release held routes
          await rangeCtl.releaseAll();
          await page.unroute("**/api/doc-asset**").catch(() => undefined);
        }

        // ── Zero-page ──────────────────────────────────────────────────
        log("INTERCEPTION: zero-page");
        await openPdf(page, baseUrl, "zero-page.pdf");
        await assertStateCard(page, "empty", mode);
        const prevDisabled = await page
          .locator('[data-testid="pdf-toolbar-prev"]')
          .isDisabled();
        const nextDisabled = await page
          .locator('[data-testid="pdf-toolbar-next"]')
          .isDisabled();
        assert(prevDisabled && nextDisabled, "zero-page: toolbar not disabled");
        (inter.states as Record<string, unknown>).empty = {
          prevDisabled,
          nextDisabled,
        };

        // ── Corrupt ────────────────────────────────────────────────────
        log("INTERCEPTION: corrupt");
        await openPdf(page, baseUrl, "corrupt.pdf");
        // Either state card (no extracted text) or fallback path
        await page.waitForFunction(
          () =>
            Boolean(
              document.querySelector('[data-testid="pdf-state-corrupt"]') ||
              document.querySelector('[data-testid="pdf-fallback-corrupt"]')
            ),
          null,
          { timeout: 30_000 }
        );
        if (
          (await page.locator('[data-testid="pdf-state-corrupt"]').count()) > 0
        ) {
          await assertStateCard(page, "corrupt", mode);
        } else {
          await shot(page, "state-corrupt", mode);
        }
        await assertFallbackIfExtracted(
          page,
          baseUrl,
          "corrupt.pdf",
          "corrupt"
        );
        (inter.states as Record<string, unknown>).corrupt = {
          hasCard: await page
            .locator('[data-testid="pdf-state-corrupt"]')
            .count(),
          hasFallback: await page
            .locator('[data-testid="pdf-fallback-corrupt"]')
            .count(),
        };

        // ── Password ───────────────────────────────────────────────────
        log("INTERCEPTION: password");
        await openPdf(page, baseUrl, "password-protected.pdf");
        try {
          await page.waitForFunction(
            () =>
              Boolean(
                document.querySelector('[data-testid="pdf-state-password"]') ||
                document.querySelector('[data-testid="pdf-fallback-password"]')
              ),
            null,
            { timeout: 30_000 }
          );
        } catch (error) {
          const diagnostic = await page.evaluate(() => ({
            states: [
              ...document.querySelectorAll('[data-testid^="pdf-state-"]'),
            ].map((node) => ({
              testId: node.getAttribute("data-testid"),
              text: node.textContent,
            })),
            fallbacks: [
              ...document.querySelectorAll('[data-testid^="pdf-fallback-"]'),
            ].map((node) => ({
              testId: node.getAttribute("data-testid"),
              text: node.textContent,
            })),
            viewer: document.querySelector('[data-testid="pdf-viewer"]')
              ?.textContent,
            body: document.body.textContent?.slice(0, 1000),
          }));
          throw new Error(
            `password state timeout: ${JSON.stringify(diagnostic)}; browserConsole=${JSON.stringify(consoleLogs.slice(-20))}`,
            { cause: error }
          );
        }
        if (
          (await page.locator('[data-testid="pdf-state-password"]').count()) > 0
        ) {
          await assertStateCard(page, "password", mode);
        } else {
          await shot(page, "state-password", mode);
        }
        await assertFallbackIfExtracted(
          page,
          baseUrl,
          "password-protected.pdf",
          "password"
        );
        (inter.states as Record<string, unknown>).password = {
          hasCard: await page
            .locator('[data-testid="pdf-state-password"]')
            .count(),
        };

        // ── Network abort ──────────────────────────────────────────────
        log("INTERCEPTION: network abort");
        // Two surfaces, both required by the R8 + task-.5 contracts:
        //   (a) the Pages-branch state card, which only mounts when the doc has
        //       NO extracted text (otherwise DocView switches to Text), and
        //   (b) the Text-branch fallback notice on a doc that HAS extracted text.
        const noTextFixture = await pickNoExtractedTextFixture(baseUrl, [
          "zero-page.pdf",
          "corrupt.pdf",
          "password-protected.pdf",
        ]);
        log(`network abort: state-card fixture=${noTextFixture}`);
        const abortRoute = async (
          route: Route,
          match: string
        ): Promise<void> => {
          if (route.request().url().includes(match)) {
            await route.abort("failed");
            return;
          }
          await route.continue();
        };

        await page.route("**/api/doc-asset**", (route) =>
          abortRoute(route, noTextFixture.replace(/\.pdf$/u, ""))
        );
        await openPdf(page, baseUrl, noTextFixture);
        await page.waitForSelector('[data-testid="pdf-state-network"]', {
          timeout: 30_000,
        });
        await assertStateCard(page, "network", mode);
        // Must NOT classify as bootstrap
        assert(
          (await page
            .locator('[data-testid="pdf-state-bootstrap"]')
            .count()) === 0,
          "network abort must not show bootstrap state"
        );
        const networkCardCount = await page
          .locator('[data-testid="pdf-state-network"]')
          .count();
        await page.unroute("**/api/doc-asset**");

        // (b) fallback notice on a doc that does have extracted text
        await page.route("**/api/doc-asset**", (route) =>
          abortRoute(route, "viewer-links")
        );
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await assertFallbackIfExtracted(
          page,
          baseUrl,
          "viewer-links.pdf",
          "network"
        );
        (inter.states as Record<string, unknown>).network = {
          card: networkCardCount,
          cardFixture: noTextFixture,
          fallbackFixture: "viewer-links.pdf",
        };
        await page.unroute("**/api/doc-asset**");

        // ── Bootstrap worker 404 ───────────────────────────────────────
        log("INTERCEPTION: bootstrap worker 404");
        await page.route(
          "**/vendor/pdfjs/pdf.worker.min.mjs",
          async (route) => {
            await route.fulfill({ status: 404, body: "missing" });
          }
        );
        // Same two surfaces as the network state: the Pages-branch card only
        // mounts for a doc with no extracted text.
        await openPdf(page, baseUrl, noTextFixture);
        await page.waitForSelector('[data-testid="pdf-state-bootstrap"]', {
          timeout: 45_000,
        });
        await assertStateCard(page, "bootstrap", mode);
        // Exact bootstrap only — not network/corrupt alternate
        assert(
          (await page.locator('[data-testid="pdf-state-network"]').count()) ===
            0,
          "bootstrap must not be classified as network"
        );
        const bootstrapCardText = await page
          .locator('[data-testid="pdf-state-bootstrap"]')
          .textContent();
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await assertFallbackIfExtracted(
          page,
          baseUrl,
          "viewer-links.pdf",
          "bootstrap"
        );
        (inter.states as Record<string, unknown>).bootstrap = {
          text: bootstrapCardText,
          cardFixture: noTextFixture,
          fallbackFixture: "viewer-links.pdf",
        };
        await page.unroute("**/vendor/pdfjs/pdf.worker.min.mjs");

        // ── Auxiliary cMap 404 (×2, deterministic) ─────────────────────
        log("INTERCEPTION: aux cMap 404 ×2");
        const auxCmap: Array<Record<string, unknown>> = [];
        for (let run = 0; run < 2; run++) {
          // Fresh page per run: PDF.js caches font/CMap translation per
          // page, so a shared page makes the second run reuse the cached
          // failure and emit no warning. Same context/session/origin and
          // real production requests are preserved.
          const page = await ctx.newPage();
          const { nonSelf: auxNonSelf } = attachLogging(page, mode, baseOrigin);
          const warnings: string[] = [];
          const onConsole = (msg: {
            type: () => string;
            text: () => string;
          }) => {
            if (
              msg.type() === "warning" ||
              msg.type() === "error" ||
              msg.type() === "pageerror"
            ) {
              warnings.push(msg.text());
            }
          };
          page.on("console", onConsole);
          page.on("pageerror", (err) => {
            warnings.push(`pageerror:${err.message}`);
          });
          let attempted404 = false;
          let status404 = 0;
          await page.route("**/vendor/pdfjs/cmaps/**", async (route) => {
            attempted404 = true;
            status404 = 404;
            await route.fulfill({ status: 404, body: "no-cmap" });
          });
          await openPdf(page, baseUrl, "cjk-cmap.pdf");
          await waitForProgressive(page);
          await page
            .waitForLoadState("networkidle", { timeout: 8000 })
            .catch(() => undefined);
          // PDF.js emits auxiliary-asset warnings asynchronously after the page
          // is otherwise idle; settle before reading any observation.
          await waitForConsoleQuiet(warnings);
          const textLayer =
            (await page
              .locator(".gno-pdf-text-layer")
              .textContent()
              .catch(() => "")) ?? "";
          const nonBlank = await canvasNonBlank(page).catch(() => false);
          const pageError =
            warnings.find((w) => w.startsWith("pageerror:"))?.slice(10) ?? null;
          // Snapshot the warnings the classification was actually computed
          // from — later steps (toggle/zoom/download) add console output, so a
          // post-hoc array would not be what was compared.
          const warningsAtClassification = [...warnings];
          const warningSignature = auxWarningSignature(
            warningsAtClassification
          );
          const classification = classifyAuxOutcome({
            warnings: warningsAtClassification,
            textLayer,
            nonBlank,
            pageError,
          });
          // Actionable viewer
          const actionable = await page.evaluate(() => {
            const toolbar = document.querySelector(
              '[data-testid="pdf-toolbar"]'
            );
            const toggle = document.querySelector(
              '[data-testid="pdf-pages-text-toggle"]'
            );
            const dl = document.querySelector(
              '[data-testid="pdf-header-download"], [data-testid="pdf-toolbar-download"]'
            );
            return {
              toolbar: Boolean(toolbar),
              toggle: Boolean(toggle),
              download: Boolean(dl),
              crashed: !document.body,
            };
          });
          // Viewer must stay actionable: toolbar responds, toggle switches
          // branches, download/open-original really resolves.
          const cmapActionProof = await assertViewerActionable(
            page,
            baseOrigin,
            `aux-cmap-404 run${run}`
          );
          // Security headers still present on page
          const resp = await page.goto(page.url(), {
            waitUntil: "domcontentloaded",
          });
          // re-open after goto for consistency of second run — capture headers first
          const hdrs = resp?.headers() ?? {};
          assertSecurityHeaders(hdrs, `aux-cmap-404 run${run} page`);

          // Re-establish route and reopen for observation consistency after goto
          await page.unroute("**/vendor/pdfjs/cmaps/**");
          await page.route("**/vendor/pdfjs/cmaps/**", async (route) => {
            attempted404 = true;
            status404 = 404;
            await route.fulfill({ status: 404, body: "no-cmap" });
          });
          await openPdf(page, baseUrl, "cjk-cmap.pdf");
          await waitForProgressive(page);

          const nonSelfDelta = auxNonSelf.length;
          assert(attempted404 && status404 === 404, "cMap 404 not attempted");
          assert(nonSelfDelta === 0, `cMap 404 non-self=${nonSelfDelta}`);
          assert(!actionable.crashed, "cMap 404 crashed app");
          assert(
            actionable.toolbar && actionable.toggle && actionable.download,
            `cMap 404 not actionable: ${JSON.stringify(actionable)}`
          );

          auxCmap.push({
            run,
            attempted404,
            status404,
            classification,
            warnings: warningsAtClassification.slice(0, 40),
            warningSignature,
            textLayerLen: textLayer.length,
            nonBlank,
            actionable,
            actionProof: cmapActionProof,
            nonSelfDelta,
          });
          page.off("console", onConsole);
          await page.unroute("**/vendor/pdfjs/cmaps/**");
          await page.close();
        }
        inter.auxCmap404 = auxCmap;
        assert(
          (auxCmap[0] as { classification: string }).classification ===
            (auxCmap[1] as { classification: string }).classification,
          `cMap 404 classifications differ: ${JSON.stringify(auxCmap)}`
        );

        // ── Auxiliary standard-font 404 (×2) ───────────────────────────
        log("INTERCEPTION: aux standard-font 404 ×2");
        const auxFont: Array<Record<string, unknown>> = [];
        for (let run = 0; run < 2; run++) {
          // Fresh page per run: PDF.js caches font/CMap translation per
          // page, so a shared page makes the second run reuse the cached
          // failure and emit no warning. Same context/session/origin and
          // real production requests are preserved.
          const page = await ctx.newPage();
          const { nonSelf: auxNonSelf } = attachLogging(page, mode, baseOrigin);
          const warnings: string[] = [];
          const onConsole = (msg: {
            type: () => string;
            text: () => string;
          }) => {
            if (
              msg.type() === "warning" ||
              msg.type() === "error" ||
              msg.type() === "pageerror"
            ) {
              warnings.push(msg.text());
            }
          };
          page.on("console", onConsole);
          let attempted404 = false;
          await page.route(
            "**/vendor/pdfjs/standard_fonts/**",
            async (route) => {
              attempted404 = true;
              await route.fulfill({ status: 404, body: "no-font" });
            }
          );
          await openPdf(page, baseUrl, "standard-font.pdf");
          await waitForProgressive(page);
          await page
            .waitForLoadState("networkidle", { timeout: 8000 })
            .catch(() => undefined);
          // PDF.js emits auxiliary-asset warnings asynchronously after the page
          // is otherwise idle; settle before reading any observation.
          await waitForConsoleQuiet(warnings);
          const textLayer =
            (await page
              .locator(".gno-pdf-text-layer")
              .textContent()
              .catch(() => "")) ?? "";
          const nonBlank = await canvasNonBlank(page).catch(() => false);
          // Snapshot the warnings the classification was actually computed
          // from — later steps (toggle/zoom/download) add console output, so a
          // post-hoc array would not be what was compared.
          const warningsAtClassification = [...warnings];
          const warningSignature = auxWarningSignature(
            warningsAtClassification
          );
          const classification = classifyAuxOutcome({
            warnings: warningsAtClassification,
            textLayer,
            nonBlank,
            pageError: null,
          });
          const actionable = await page.evaluate(() => ({
            toolbar: Boolean(
              document.querySelector('[data-testid="pdf-toolbar"]')
            ),
            toggle: Boolean(
              document.querySelector('[data-testid="pdf-pages-text-toggle"]')
            ),
            download: Boolean(
              document.querySelector(
                '[data-testid="pdf-header-download"], [data-testid="pdf-toolbar-download"]'
              )
            ),
            crashed: !document.body,
          }));
          // Viewer must stay actionable: toolbar responds, toggle switches
          // branches, download/open-original really resolves.
          const fontActionProof = await assertViewerActionable(
            page,
            baseOrigin,
            `aux-font-404 run${run}`
          );
          const nonSelfDelta = auxNonSelf.length;
          assert(attempted404, "standard_fonts 404 not attempted");
          assert(nonSelfDelta === 0, `font 404 non-self=${nonSelfDelta}`);
          assert(!actionable.crashed, "font 404 crashed");
          assert(
            actionable.toolbar && actionable.toggle && actionable.download,
            `font 404 not actionable: ${JSON.stringify(actionable)}`
          );

          auxFont.push({
            run,
            attempted404,
            classification,
            warnings: warningsAtClassification.slice(0, 40),
            warningSignature,
            textLayerLen: textLayer.length,
            nonBlank,
            actionable,
            actionProof: fontActionProof,
            nonSelfDelta,
          });
          page.off("console", onConsole);
          await page.unroute("**/vendor/pdfjs/standard_fonts/**");
          await page.close();
        }
        inter.auxFont404 = auxFont;
        assert(
          (auxFont[0] as { classification: string }).classification ===
            (auxFont[1] as { classification: string }).classification,
          `font 404 classifications differ: ${JSON.stringify(auxFont)}`
        );

        // ── Alignment at 100%, fit-width, 200% ─────────────────────────
        log("INTERCEPTION: alignment");
        // Leave whatever the previous stage left mounted: navigating to the
        // same doc URL can no-op in the SPA and measure a stale text layer.
        await page.goto(`${baseUrl}/search`, { waitUntil: "domcontentloaded" });
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        await ensureMetricsAttached(page);

        // 100%
        await zoomToPercent(page, 100);
        await waitForVisibleSettled(page).catch(() => undefined);
        await waitForKnownGlyphText(page);
        let align = await selectKnownGlyph(page);
        assert(
          align.overlapOk,
          `align 100% overlap fail Δ=${align.maxDelta} detail=${JSON.stringify(align)}`
        );
        await shot(page, "align-100", mode);

        // fit-width
        await page.locator('[data-testid="pdf-toolbar-fit-width"]').click();
        await waitForVisibleSettled(page).catch(() => undefined);
        await waitForKnownGlyphText(page);
        align = await selectKnownGlyph(page);
        assert(
          align.overlapOk,
          `align fit-width overlap fail Δ=${align.maxDelta} detail=${JSON.stringify(align)}`
        );
        await shot(page, "align-fit-width", mode);

        // 200%
        await zoomToPercent(page, 200);
        await waitForVisibleSettled(page).catch(() => undefined);
        await waitForKnownGlyphText(page);
        align = await selectKnownGlyph(page);
        assert(
          align.overlapOk,
          `align 200% overlap fail Δ=${align.maxDelta} detail=${JSON.stringify(align)}`
        );
        await shot(page, "align-200", mode);
        inter.alignment = {
          tolerancePx: ALIGN_TOL_PX,
          at100: true,
          atFitWidth: true,
          at200: true,
          last: align,
        };

        // ── P-2 live canvas ≤ 10 ───────────────────────────────────────
        log("INTERCEPTION: P-2 live canvas ceiling");
        await openPdf(page, baseUrl, "large-200.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        const liveCounts: number[] = [];
        for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
          await page.evaluate((f) => {
            const col = document.querySelector(
              '[data-testid="pdf-page-column"]'
            ) as HTMLElement | null;
            if (col) {
              col.scrollTop =
                f * Math.max(0, col.scrollHeight - col.clientHeight);
            }
          }, frac);
          // Wait for virtualization settle via metrics or rendered change
          await page
            .waitForFunction(
              () =>
                document.querySelectorAll(
                  'canvas.gno-pdf-canvas[data-gno-pdf-backing="1"]'
                ).length > 0,
              null,
              { timeout: 5000 }
            )
            .catch(() => undefined);
          const n = await page.evaluate(
            () =>
              document.querySelectorAll(
                'canvas.gno-pdf-canvas[data-gno-pdf-backing="1"]'
              ).length
          );
          liveCounts.push(n);
        }
        inter.p2LiveCanvases = liveCounts;
        const p2Max = Math.max(...liveCounts);
        if (p2Max > 10) {
          budgetFail(
            `P-2 live nonzero backing canvases max=${p2Max} > 10 at positions ${JSON.stringify(liveCounts)}`
          );
        }

        // ── P-3 scroll 200 pages ───────────────────────────────────────
        log("INTERCEPTION: P-3 scroll procedure");
        // Reset BEFORE document load; identify doc after load
        await page.goto(`${baseUrl}/search`, {
          waitUntil: "domcontentloaded",
        });
        // Open PDF, attach metrics, reset, then re-open for clean window
        await openPdf(page, baseUrl, "large-200.pdf");
        await waitForProgressive(page);
        await ensureMetricsAttached(page);
        await metricsReset(page, 50_000);
        // Re-load document after reset so window only covers this scroll
        await openPdf(page, baseUrl, "large-200.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        const docIdP3 = await currentDocId(page);
        assert(docIdP3, "P-3: could not identify docId after load");

        // Exact procedure: top→bottom viewport steps @ 50ms + 2s settle
        await page.evaluate(async () => {
          const col = document.querySelector(
            '[data-testid="pdf-page-column"]'
          ) as HTMLElement | null;
          if (!col) {
            return;
          }
          const step = col.clientHeight || 600;
          col.scrollTop = 0;
          while (col.scrollTop + col.clientHeight < col.scrollHeight - 2) {
            col.scrollTop = Math.min(col.scrollTop + step, col.scrollHeight);
            await new Promise((r) => setTimeout(r, 50));
          }
          col.scrollTop = col.scrollHeight;
        });
        await Bun.sleep(2000); // mandated settle

        let p3 = await metricsSnapshot(page);
        let p3DocId = docIdP3;
        if (p3.dropped !== 0) {
          await metricsReset(page, 100_000);
          await openPdf(page, baseUrl, "large-200.pdf");
          await waitForProgressive(page);
          await waitForNonBlankCanvas(page);
          // Re-identify: the re-opened document is a NEW instance with a new
          // docId. Filtering the retry snapshot by the stale id would report
          // zero starts and pass vacuously.
          const retryDocId = await currentDocId(page);
          assert(retryDocId, "P-3: could not identify docId after retry load");
          p3DocId = retryDocId;
          await page.evaluate(async () => {
            const col = document.querySelector(
              '[data-testid="pdf-page-column"]'
            ) as HTMLElement | null;
            if (!col) {
              return;
            }
            const step = col.clientHeight || 600;
            col.scrollTop = 0;
            while (col.scrollTop + col.clientHeight < col.scrollHeight - 2) {
              col.scrollTop = Math.min(col.scrollTop + step, col.scrollHeight);
              await new Promise((r) => setTimeout(r, 50));
            }
            col.scrollTop = col.scrollHeight;
          });
          await Bun.sleep(2000);
          p3 = await metricsSnapshot(page);
        }
        assertDroppedZero(p3, "P-3");
        // Second half of the mandated non-vacuity check: after the scroll has
        // settled, the FINAL window must actually be painted. `renderStart > 0`
        // alone can be satisfied by early pages that were later evicted, and
        // the pre-scroll `waitForNonBlankCanvas` witnesses the initial window,
        // not this one — so a gate that deferred every final-window page
        // forever would still pass without this.
        const p3FinalRendered = await page.evaluate(
          () => document.querySelectorAll('[data-rendered="true"]').length
        );
        assert(
          p3FinalRendered >= 1,
          `P-3 non-vacuity: no final-window page reached data-rendered="true" after the settle (count=${p3FinalRendered})`
        );
        const p3Starts = p3.events.filter(
          (e) => e.kind === "renderStart" && e.docId === p3DocId
        );
        const p3Settles = p3.events.filter(
          (e) => e.kind === "renderSettle" && e.docId === p3DocId
        );
        let orphans = 0;
        let doubles = 0;
        for (const s of p3Starts) {
          const n = p3Settles.filter((e) => e.taskId === s.taskId).length;
          if (n === 0) {
            orphans += 1;
          }
          if (n > 1) {
            doubles += 1;
          }
        }
        inter.p3 = {
          renderStarts: p3Starts.length,
          settles: p3Settles.length,
          orphans,
          doubles,
          dropped: p3.dropped,
          docId: p3DocId,
          finalWindowRendered: p3FinalRendered,
        };
        // Non-vacuity: a window with zero starts would satisfy the ceiling and
        // the orphan check without having measured anything.
        assert(
          p3Starts.length > 0,
          `P-3: zero renderStart events for docId=${p3DocId} — window measured nothing`
        );
        if (p3Starts.length > P3_MAX_STARTS) {
          budgetFail(
            `P-3 renderStart ${p3Starts.length} > ${P3_MAX_STARTS} (200-page top→bottom scroll, viewport-height steps @50ms + 2s settle; orphans=${orphans} doubles=${doubles} dropped=${p3.dropped})`
          );
        }
        if (orphans > 0 || doubles > 0) {
          fail(`P-3 orphans=${orphans} doubles=${doubles}`);
        }
        await Bun.write(
          join(ARTIFACT_DIR, "p3-metrics.json"),
          JSON.stringify(await metricsExport(page), null, 2)
        );

        // ── P-4a sequential zoom latency ───────────────────────────────
        log("INTERCEPTION: P-4a sequential zoom 100%↔200%");
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        await ensureMetricsAttached(page);
        // Genuine custom-mode 100% entry: the doc opens fit-width, where the
        // label already reads 100% and selecting it commits nothing.
        await establishCustom100(page);
        await waitForVisibleSettled(page);
        await metricsReset(page, 50_000);

        const samples: number[] = [];
        const p4aCorrelation: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 20; i++) {
          const target: 100 | 200 = i % 2 === 0 ? 200 : 100;
          const beforeSnap = await metricsSnapshot(page);
          const beforeSeq = beforeSnap.seqHigh;
          // Pre-open the listbox so no portal-mount latency sits inside the
          // measured window; the open precedes t0.
          await openZoomListbox(page);
          // t0 is read inside the SAME in-page evaluation as the single
          // dispatched gesture, so no driver round-trip lies inside a sample.
          const sample = await page.evaluate(
            async ({ pct, prevSeq }) => {
              const option = document.querySelector(
                `[data-testid="pdf-toolbar-zoom-option-${pct}"]`
              ) as HTMLElement | null;
              if (!option) {
                throw new Error(`zoom option ${pct}% not mounted`);
              }
              const t0 = performance.now();
              option.click();
              const deadline = t0 + 15_000;
              const targetScale = pct / 100;
              for (;;) {
                const m = (
                  globalThis as unknown as {
                    __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
                  }
                ).__gnoPdfMetrics?.snapshot();
                if (m) {
                  // Correlate to THIS commit: a start after the baseline whose
                  // committed scale is the selection's target. Window-entry or
                  // stale-scale renders (the first React pass carries the new
                  // generation with the previous scale) can never satisfy it.
                  const targetStarts = m.events.filter(
                    (e) =>
                      e.kind === "renderStart" &&
                      e.seq > prevSeq &&
                      Math.abs((e.scale as number) - targetScale) <= 1e-6
                  );
                  const settledAtTarget = m.events.filter(
                    (e) =>
                      e.kind === "renderSettle" &&
                      e.outcome === "completed" &&
                      targetStarts.some((st) => st.taskId === e.taskId)
                  );
                  if (
                    targetStarts.length > 0 &&
                    settledAtTarget.length === targetStarts.length
                  ) {
                    const last = settledAtTarget.reduce(
                      (acc, e) => (e.t > acc ? e.t : acc),
                      Number.NEGATIVE_INFINITY
                    );
                    return {
                      ms: last - t0,
                      targetScale,
                      starts: targetStarts.length,
                      genIds: [...new Set(targetStarts.map((e) => e.genId))],
                    };
                  }
                }
                if (performance.now() > deadline) {
                  throw new Error(
                    `P-4a commit to ${pct}% never produced a completed render at scale ${targetScale}`
                  );
                }
                await new Promise((r) => requestAnimationFrame(() => r(null)));
              }
            },
            { pct: target, prevSeq: beforeSeq }
          );
          const s4 = sample as {
            ms: number;
            targetScale: number;
            starts: number;
            genIds: number[];
          };
          assert(
            s4.starts > 0,
            `P-4a: no render at target scale ${s4.targetScale}`
          );
          p4aCorrelation.push({
            target,
            targetScale: s4.targetScale,
            starts: s4.starts,
            genIds: s4.genIds,
            ms: Number(s4.ms.toFixed(1)),
          });
          samples.push(s4.ms);
        }
        const p4aSnap = await metricsSnapshot(page);
        assertDroppedZero(p4aSnap, "P-4a");
        // Every start has exactly one settle
        const p4aStarts = p4aSnap.events.filter(
          (e) => e.kind === "renderStart"
        );
        for (const s of p4aStarts) {
          const n = p4aSnap.events.filter(
            (e) => e.kind === "renderSettle" && e.taskId === s.taskId
          ).length;
          assert(n === 1, `P-4a start ${s.taskId} has ${n} settles`);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const p95idx = Math.ceil(0.95 * 20) - 1; // 19th of 20 → index 18
        const p95 = sorted[p95idx] ?? sorted.at(-1)!;
        inter.p4a = {
          samples,
          sorted,
          p95,
          p95idx,
          correlation: p4aCorrelation,
        };
        if (p95 > P4A_P95_MS) {
          budgetFail(
            `P-4a 19th/p95=${p95.toFixed(1)}ms > ${P4A_P95_MS}ms samples=${JSON.stringify(sorted.map((n) => Number(n.toFixed(1))))}`
          );
        }
        await Bun.write(
          join(ARTIFACT_DIR, "p4a-samples.json"),
          JSON.stringify(inter.p4a, null, 2)
        );
        await Bun.write(
          join(ARTIFACT_DIR, "p4a-metrics.json"),
          JSON.stringify(await metricsExport(page), null, 2)
        );

        // ── P-4b cancellation ordering ─────────────────────────────────
        log("INTERCEPTION: P-4b cancel ordering");
        const p4bRuns: unknown[] = [];
        // Run definitions from the SHIP plan. Every replacement is an
        // already-mounted toolbar control — never a second combobox selection,
        // because Radix unmounts its listbox on selection and remounting it
        // would yield the frame in which the superseded render settles.
        const P4B_RUNS = {
          A: {
            id: "A",
            initiate: 200,
            initiateScale: 2,
            replacementScale: 2.1,
            replacement: '[data-testid="pdf-toolbar-zoom-in"]',
            expectKind: "zoom" as const,
            expectZoom: "210%",
          },
          B: {
            id: "B",
            initiate: 300,
            initiateScale: 3,
            // fit-page is viewport-derived: asserted as "changed, and matching
            // the fit-page state" rather than a predicted constant.
            replacementScale: null,
            replacement: '[data-testid="pdf-toolbar-fit-page"]',
            expectKind: "fit" as const,
            expectZoom: null,
          },
          C: {
            id: "C",
            initiate: 300,
            initiateScale: 3,
            replacementScale: 3.1,
            replacement: '[data-testid="pdf-toolbar-zoom-in"]',
            expectKind: "zoom" as const,
            expectZoom: "310%",
          },
        };
        // Exact ordered ladder: small A → 200-page A → 200-page C → larger
        // viewport C → deviceScaleFactor 2 C. No rung enters at max zoom.
        const P4B_LADDER = [
          {
            run: "A",
            fixture: "viewer-links.pdf",
            viewport: { width: 1380, height: 900 },
            dsf: 1,
          },
          {
            run: "A",
            fixture: "large-200.pdf",
            viewport: { width: 1380, height: 900 },
            dsf: 1,
          },
          {
            run: "C",
            fixture: "large-200.pdf",
            viewport: { width: 1380, height: 900 },
            dsf: 1,
          },
          {
            run: "C",
            fixture: "large-200.pdf",
            viewport: { width: 1900, height: 1200 },
            dsf: 1,
          },
          {
            run: "C",
            fixture: "large-200.pdf",
            viewport: { width: 1900, height: 1200 },
            dsf: 2,
          },
        ] as const;

        type P4bRung = (typeof P4B_LADDER)[number];
        type P4bRunDef = {
          id: string;
          initiate: number;
          initiateScale: number;
          replacementScale: number | null;
          replacement: string;
          expectKind: "zoom" | "fit";
          expectZoom: string | null;
        };

        /**
         * Commit the 100%/custom entry state and POSITIVELY observe its own
         * generation start and matching completed settle before the caller
         * resets metrics.
         *
         * Without this the baseline can precede the entry generation, and the
         * attempt then latches onto the entry render as the "superseded" one —
         * making the initiating selection masquerade as the replacement
         * (Sol SOL6-IMPL-01). Metrics are reset only after this returns.
         */
        type EntryProof = {
          baselineSeq: number;
          maxGenBefore: number;
          entryGenId: number;
          entryScale: number;
          starts: Array<Record<string, unknown>>;
          settles: Array<Record<string, unknown>>;
          quiescenceSeq: number;
          /**
           * The seqHigh that was actually live in the page at the instant
           * `reset()` ran — captured inside the same non-yielding in-page
           * block as the final snapshot, never copied from an earlier
           * driver-side observation (Sol SOL6-R3-IMPL-01).
           */
          resetBoundarySeq: number;
          postResetSeqHigh: number;
          postResetEventCount: number;
          resetCapacity: number;
        };

        /**
         * Commit the 100%/custom entry state and POSITIVELY prove it.
         *
         * There is deliberately NO fallback: if the real 150% -> 100%
         * selections commit no fresh generation, `waitForFunction` throws and
         * the rung fails loudly. Accepting the standing render would readmit
         * exactly the same-value/no-op case this oracle exists to exclude
         * (Sol SOL6-R2-IMPL-01).
         *
         * Returns the entry proof captured BEFORE the caller resets metrics, so
         * the setup remains auditable in the persisted artifact even though the
         * attempt itself starts from a cleared channel.
         */
        const commitSettledEntryState = async (
          target: Page,
          capacity: number
        ): Promise<EntryProof> => {
          await ensureMetricsAttached(target);
          const before = await metricsSnapshot(target);
          const baselineSeq = before.seqHigh;
          const priorGens = before.events
            .filter((e) => e.kind === "renderStart")
            .map((e) => e.genId as number);
          const maxGenBefore =
            priorGens.length > 0 ? Math.max(...priorGens) : -1;

          // Genuine custom-mode 100%: selecting 100% straight from fit-width
          // commits nothing (Radix no-op), which would leave the entry state
          // fit-derived and the initiating-scale correlation meaningless.
          await establishCustom100(target);

          // A post-baseline generation at EXACTLY logical scale 1 must start
          // and every such start must reach a completed settle. No catch.
          await target.waitForFunction(
            (args) => {
              const m = (
                globalThis as unknown as {
                  __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
                }
              ).__gnoPdfMetrics?.snapshot();
              if (!m) {
                return false;
              }
              const fresh = m.events.filter(
                (e) =>
                  e.kind === "renderStart" &&
                  e.seq > args.seq &&
                  (e.genId as number) > args.gen &&
                  Math.abs((e.scale as number) - 1) <= 1e-6
              );
              if (fresh.length === 0) {
                return false;
              }
              return fresh.every((st) =>
                m.events.some(
                  (e) =>
                    e.kind === "renderSettle" &&
                    e.taskId === st.taskId &&
                    e.outcome === "completed"
                )
              );
            },
            { seq: baselineSeq, gen: maxGenBefore },
            { timeout: 30_000 }
          );

          // Race-safe quiescence boundary AND the metrics reset are ONE atomic,
          // non-yielding in-page operation: once the loop observes a stable
          // frame (every start settled AND seqHigh unchanged across two
          // consecutive animation frames), the entry validation, the
          // `reset()` call and the post-reset snapshot all run synchronously
          // in that same turn. No await, microtask, or driver round-trip sits
          // between the final snapshot and the reset, so no renderStart can
          // slip in unrecorded and `resetBoundarySeq` is the seq that was
          // genuinely live at reset time (Sol SOL6-R3-IMPL-01).
          const stable = (await target.evaluate(
            async (args) => {
              const api = (
                globalThis as unknown as {
                  __gnoPdfMetrics?: {
                    snapshot: () => MetricsSnap;
                    reset: (o: { capacity: number }) => void;
                  };
                }
              ).__gnoPdfMetrics;
              if (!api) {
                throw new Error("P-4b entry proof: metrics channel missing");
              }
              const settledAll = (m: MetricsSnap): boolean =>
                m.events
                  .filter((e) => e.kind === "renderStart")
                  .every((st) =>
                    m.events.some(
                      (e) => e.kind === "renderSettle" && e.taskId === st.taskId
                    )
                  );
              const deadline = performance.now() + 30_000;
              let prevSeq = -1;
              for (;;) {
                const m = api.snapshot();
                if (m && settledAll(m) && m.seqHigh === prevSeq) {
                  // ── begin non-yielding critical section ──────────────────
                  const entryStarts = m.events.filter(
                    (e) =>
                      e.kind === "renderStart" &&
                      e.seq > args.baselineSeq &&
                      (e.genId as number) > args.maxGenBefore &&
                      Math.abs((e.scale as number) - 1) <= 1e-6
                  );
                  if (entryStarts.length === 0) {
                    throw new Error(
                      "P-4b entry proof: no post-baseline generation at logical scale 1"
                    );
                  }
                  const entryIds = new Set(entryStarts.map((e) => e.taskId));
                  const entrySettles = m.events.filter(
                    (e) =>
                      e.kind === "renderSettle" &&
                      entryIds.has(e.taskId) &&
                      e.outcome === "completed"
                  );
                  if (entrySettles.length !== entryStarts.length) {
                    throw new Error(
                      `P-4b entry proof: ${entryStarts.length} entry starts but ${entrySettles.length} completed settles`
                    );
                  }
                  const resetBoundarySeq = m.seqHigh;
                  api.reset({ capacity: args.capacity });
                  const after = api.snapshot();
                  // ── end non-yielding critical section ────────────────────
                  return {
                    seqHigh: m.seqHigh,
                    entryStarts,
                    entrySettles,
                    resetBoundarySeq,
                    postResetSeqHigh: after.seqHigh,
                    postResetEventCount: after.events.length,
                    resetCapacity: after.capacity,
                  };
                }
                if (m) {
                  prevSeq = m.seqHigh;
                }
                if (performance.now() > deadline) {
                  throw new Error(
                    "P-4b entry state never reached a stable quiescence boundary"
                  );
                }
                await new Promise((r) => requestAnimationFrame(() => r(null)));
              }
            },
            { baselineSeq, maxGenBefore, capacity }
          )) as {
            seqHigh: number;
            entryStarts: MetricsEvent[];
            entrySettles: MetricsEvent[];
            resetBoundarySeq: number;
            postResetSeqHigh: number;
            postResetEventCount: number;
            resetCapacity: number;
          };

          const entryStarts = stable.entryStarts;
          const entrySettles = stable.entrySettles;
          assert(
            entryStarts.length > 0,
            "P-4b entry proof: no post-baseline generation at logical scale 1"
          );
          assert(
            entrySettles.length === entryStarts.length,
            `P-4b entry proof: ${entryStarts.length} entry starts but ${entrySettles.length} completed settles`
          );
          // The reset genuinely cleared the channel at the proven boundary:
          // the attempt stream that follows therefore begins strictly after it
          // (post-reset seq restarts at 0, so every attempt event has seq >= 1).
          assert(
            stable.resetBoundarySeq === stable.seqHigh,
            `P-4b entry proof: reset boundary ${stable.resetBoundarySeq} != quiescent seqHigh ${stable.seqHigh}`
          );
          assert(
            stable.postResetSeqHigh === 0 && stable.postResetEventCount === 0,
            `P-4b entry proof: reset did not clear the channel (seqHigh=${stable.postResetSeqHigh}, events=${stable.postResetEventCount})`
          );
          assert(
            stable.resetCapacity === capacity,
            `P-4b entry proof: reset capacity ${stable.resetCapacity} != requested ${capacity}`
          );
          const entryGenId = entryStarts[0]!.genId as number;
          return {
            baselineSeq,
            maxGenBefore,
            entryGenId,
            entryScale: 1,
            starts: entryStarts.map((e) => ({
              taskId: e.taskId,
              seq: e.seq,
              scale: e.scale,
              genId: e.genId,
              pageNumber: e.pageNumber,
            })),
            settles: entrySettles.map((e) => ({
              taskId: e.taskId,
              seq: e.seq,
              scale: e.scale,
              outcome: e.outcome,
            })),
            quiescenceSeq: stable.seqHigh,
            resetBoundarySeq: stable.resetBoundarySeq,
            postResetSeqHigh: stable.postResetSeqHigh,
            postResetEventCount: stable.postResetEventCount,
            resetCapacity: stable.resetCapacity,
          };
        };

        /**
         * One whole attempt in a single async in-page evaluation: readiness →
         * baseline → initiating activation → in-flight observation →
         * synchronous replacement dispatch → second generation. No driver
         * round-trip and no yield between observation and replacement.
         */
        const attemptP4bOnPage = async (
          target: Page,
          def: P4bRunDef
        ): Promise<Record<string, unknown>> => {
          // Pre-open the combobox and await portal readiness BEFORE baseline.
          await openZoomListbox(target);
          return (await target.evaluate(
            async ({ pct, sel, initScale, replScale }) => {
              const option = document.querySelector(
                `[data-testid="pdf-toolbar-zoom-option-${pct}"]`
              ) as HTMLElement | null;
              if (!option) {
                return { ok: false, reason: "initiating option not mounted" };
              }
              if (option.getAttribute("aria-disabled") === "true") {
                return { ok: false, reason: "initiating option disabled" };
              }
              const replacement = document.querySelector(
                sel
              ) as HTMLButtonElement | null;
              if (!replacement) {
                return { ok: false, reason: "replacement control not mounted" };
              }
              if (replacement.disabled) {
                return { ok: false, reason: "replacement control disabled" };
              }
              const zoomLabelBefore =
                document.querySelector('[data-testid="pdf-toolbar-zoom-level"]')
                  ?.textContent ?? "";
              // Non-no-op: the initiating selection must actually change zoom.
              if (zoomLabelBefore.includes(`${pct}%`)) {
                return { ok: false, reason: "initiating selection is a no-op" };
              }
              const snap = () =>
                (
                  globalThis as unknown as {
                    __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
                  }
                ).__gnoPdfMetrics?.snapshot();
              const base = snap();
              if (!base) {
                return { ok: false, reason: "metrics channel unavailable" };
              }
              const priorGens = base.events
                .filter((e) => e.kind === "renderStart")
                .map((e) => e.genId as number);
              const maxGenBefore =
                priorGens.length > 0 ? Math.max(...priorGens) : -1;

              // Event-driven overlap. The render can settle inside a single
              // frame, so rAF/snapshot polling misses the in-flight interval
              // entirely. Instead, temporarily wrap the channel's own
              // recordRenderStart: the original is called unchanged (no
              // fabricated events), and the moment the INITIATING generation's
              // start is recorded — correlated by its logical scale — the real
              // replacement gesture is queued on a microtask. The render task
              // has therefore been admitted and assigned, but cannot have
              // settled before the genuine replacement click lands. The
              // original method is restored in `finally`.
              const channel = (
                globalThis as unknown as {
                  __gnoPdfMetrics?: {
                    recordRenderStart: (a: Record<string, unknown>) => unknown;
                  };
                }
              ).__gnoPdfMetrics;
              if (!channel) {
                return { ok: false, reason: "metrics channel unavailable" };
              }
              const originalRecordRenderStart =
                channel.recordRenderStart.bind(channel);
              let superseded: {
                taskId: string;
                genId: number;
                scale: number;
              } | null = null;
              let replacementDispatched = false;
              let replacementError: string | null = null;

              try {
                channel.recordRenderStart = (args: Record<string, unknown>) => {
                  const out = originalRecordRenderStart(args);
                  if (
                    !superseded &&
                    (args.genId as number) > maxGenBefore &&
                    Math.abs((args.scale as number) - initScale) <= 1e-6
                  ) {
                    superseded = {
                      taskId: args.taskId as string,
                      genId: args.genId as number,
                      scale: args.scale as number,
                    };
                    queueMicrotask(() => {
                      if (replacementDispatched) {
                        return;
                      }
                      replacementDispatched = true;
                      const live = document.querySelector(
                        sel
                      ) as HTMLButtonElement | null;
                      if (!live || live.disabled) {
                        replacementError =
                          "replacement control missing or disabled at dispatch";
                        return;
                      }
                      live.click();
                    });
                  }
                  return out;
                };

                option.click();

                const dInit = performance.now() + 8000;
                while (!superseded) {
                  if (performance.now() > dInit) {
                    return {
                      ok: false,
                      reason: `initiating generation at scale ${initScale} never started`,
                    };
                  }
                  await new Promise((r) => setTimeout(r, 4));
                }
                const dDispatch = performance.now() + 8000;
                while (!replacementDispatched) {
                  if (performance.now() > dDispatch) {
                    return {
                      ok: false,
                      reason: "replacement never dispatched",
                    };
                  }
                  await new Promise((r) => setTimeout(r, 4));
                }
                if (replacementError) {
                  return { ok: false, reason: replacementError };
                }
              } finally {
                channel.recordRenderStart = originalRecordRenderStart;
              }

              const d2 = performance.now() + 8000;
              for (;;) {
                const m = snap();
                const replacementStart = m?.events.find(
                  (e) =>
                    e.kind === "renderStart" &&
                    (e.genId as number) > superseded!.genId &&
                    Math.abs((e.scale as number) - superseded!.scale) > 1e-6 &&
                    (replScale === null ||
                      Math.abs((e.scale as number) - replScale) <= 1e-6)
                );
                if (m && replacementStart) {
                  return {
                    ok: true,
                    superseded,
                    replacementGenId: replacementStart.genId,
                    zoomLabelBefore,
                    events: m.events,
                  };
                }
                if (performance.now() > d2) {
                  return { ok: false, reason: "no replacement generation" };
                }
                await new Promise((r) => requestAnimationFrame(() => r(null)));
              }
            },
            {
              pct: def.initiate,
              sel: def.replacement,
              initScale: def.initiateScale,
              replScale: def.replacementScale,
            }
          )) as Record<string, unknown>;
        };

        /** Assert the full P-4b oracle for one completed attempt. */
        const assertP4bOracle = async (
          target: Page,
          def: P4bRunDef,
          rung: P4bRung,
          rungIndex: number,
          outcome: Record<string, unknown>,
          entryProof: EntryProof
        ): Promise<void> => {
          const events = (outcome.events ?? []) as MetricsEvent[];
          // The attempt stream must begin strictly after the boundary the
          // atomic entry reset cleared: reset restarts seq at 0, so every
          // attempt event carries seq >= 1 (Sol SOL6-R3-IMPL-01).
          assert(
            entryProof.postResetSeqHigh === 0,
            `P-4b ${def.id}: entry reset boundary not cleared (postResetSeqHigh=${entryProof.postResetSeqHigh})`
          );
          assert(
            events.length > 0 &&
              events.every((e) => e.seq > entryProof.postResetSeqHigh),
            `P-4b ${def.id}: attempt stream does not begin strictly after the cleared reset boundary`
          );
          const sup = outcome.superseded as {
            taskId: string;
            genId: number;
            scale: number;
          };
          // The superseded generation must be the initiating commit itself.
          assert(
            Math.abs(sup.scale - def.initiateScale) <= 1e-6,
            `P-4b ${def.id}: superseded scale ${sup.scale} != initiating ${def.initiateScale}`
          );
          const replacementGenId = outcome.replacementGenId as number;

          const cancel = events.find(
            (e) => e.kind === "renderCancel" && e.taskId === sup.taskId
          );
          const cancelledSettle = events.find(
            (e) =>
              e.kind === "renderSettle" &&
              e.taskId === sup.taskId &&
              e.outcome === "cancelled"
          );
          assert(cancel, `P-4b ${def.id}: missing renderCancel`);
          assert(cancelledSettle, `P-4b ${def.id}: missing cancelled settle`);
          assert(
            cancel!.seq < cancelledSettle!.seq,
            `P-4b ${def.id}: cancel ${cancel!.seq} >= cancelled settle ${cancelledSettle!.seq}`
          );
          // Under one generation React lands two passes: the first carries the
          // PREVIOUS scale, the second the committed target. Select the start
          // that actually carries the replacement's target scale — the stale
          // first-pass start would prove nothing about the commit.
          const replacementCandidates = events.filter(
            (e) =>
              e.kind === "renderStart" &&
              (e.genId as number) === replacementGenId &&
              e.seq > cancelledSettle!.seq
          );
          const replacementStart =
            def.replacementScale !== null
              ? replacementCandidates.find(
                  (e) =>
                    Math.abs(
                      (e.scale as number) - (def.replacementScale as number)
                    ) <= 1e-6
                )
              : replacementCandidates.find(
                  (e) => Math.abs((e.scale as number) - sup.scale) > 1e-6
                );
          assert(
            replacementStart,
            `P-4b ${def.id}: replacement start does not follow the cancelled settle`
          );
          assert(
            !events.some(
              (e) =>
                e.kind === "renderSettle" &&
                e.outcome === "completed" &&
                e.taskId === sup.taskId
            ),
            `P-4b ${def.id}: completed settle on the superseded generation`
          );

          // The replacement generation must be a genuinely different render:
          // 210% for run A / 310% for run C by exact logical scale, and for
          // run B a fit-page-derived scale that simply differs from the
          // initiating one (fit is viewport-derived, not a constant).
          assert(
            Math.abs((replacementStart!.scale as number) - sup.scale) > 1e-6,
            `P-4b ${def.id}: replacement generation reuses the initiating scale ${sup.scale}`
          );
          if (def.replacementScale !== null) {
            assert(
              Math.abs(
                (replacementStart!.scale as number) - def.replacementScale
              ) <= 1e-6,
              `P-4b ${def.id}: replacement scale ${String(replacementStart!.scale)} != expected ${def.replacementScale}`
            );
          }

          // The replacement state actually took effect.
          if (def.expectKind === "zoom") {
            await target.waitForFunction(
              (want) =>
                (
                  document.querySelector(
                    '[data-testid="pdf-toolbar-zoom-level"]'
                  )?.textContent ?? ""
                ).includes(want),
              def.expectZoom!,
              { timeout: 10_000 }
            );
          } else {
            await target.waitForFunction(
              () =>
                document
                  .querySelector('[data-testid="pdf-toolbar-fit-page"]')
                  ?.getAttribute("aria-pressed") === "true",
              null,
              { timeout: 10_000 }
            );
          }

          // No stale paint: the visible backing store must match the
          // replacement generation's recorded dims, never the superseded one's.
          await waitForVisibleSettled(target).catch(() => undefined);
          const finalSnap = await metricsSnapshot(target);
          const replacementCompleted = finalSnap.events
            .filter(
              (e) =>
                e.kind === "renderSettle" &&
                e.outcome === "completed" &&
                (e.genId as number) === replacementGenId &&
                (def.replacementScale !== null
                  ? Math.abs(
                      (e.scale as number) - (def.replacementScale as number)
                    ) <= 1e-6
                  : Math.abs((e.scale as number) - sup.scale) > 1e-6)
            )
            .at(-1);
          const replacementStartDims = finalSnap.events
            .filter(
              (e) =>
                e.kind === "renderStart" &&
                (e.genId as number) === replacementGenId
            )
            .at(-1);
          const paint = await target.evaluate(() => {
            const c = document.querySelector(
              'canvas.gno-pdf-canvas[data-gno-pdf-backing="1"]'
            ) as HTMLCanvasElement | null;
            return c ? { w: c.width, h: c.height } : null;
          });
          assert(
            paint,
            `P-4b ${def.id}: no live backing canvas after replacement`
          );
          // The replacement generation must actually COMPLETE, at its own scale.
          assert(
            replacementCompleted,
            `P-4b ${def.id}: replacement generation never reached a completed settle`
          );
          assert(
            Math.abs((replacementCompleted!.scale as number) - sup.scale) >
              1e-6,
            `P-4b ${def.id}: replacement completed settle carries the initiating scale ${sup.scale}`
          );
          if (def.replacementScale !== null) {
            assert(
              Math.abs(
                (replacementCompleted!.scale as number) - def.replacementScale
              ) <= 1e-6,
              `P-4b ${def.id}: replacement completed scale ${String(replacementCompleted!.scale)} != expected ${def.replacementScale}`
            );
          }
          if (replacementCompleted && replacementStartDims) {
            const expectedW = replacementStartDims.canvasWidth as number;
            assert(
              paint!.w === expectedW,
              `P-4b ${def.id}: stale paint — visible backing width ${paint!.w} != replacement generation width ${expectedW}`
            );
          }
          const supStart = events.find(
            (e) => e.kind === "renderStart" && e.taskId === sup.taskId
          );
          if (supStart && (supStart.canvasWidth as number) !== undefined) {
            const supW = supStart.canvasWidth as number;
            if (
              replacementStartDims &&
              (replacementStartDims.canvasWidth as number) !== supW
            ) {
              assert(
                paint!.w !== supW,
                `P-4b ${def.id}: stale paint — visible backing matches the superseded generation (${supW})`
              );
            }
          }

          p4bRuns.push({
            run: def.id,
            rungIndex,
            rung,
            expectedTransition: def.expectZoom ?? "fit-page",
            superseded: sup,
            cancelSeq: cancel!.seq,
            cancelledSettleSeq: cancelledSettle!.seq,
            replacementStartSeq: replacementStart!.seq,
            replacementGenId,
            supersededScale: sup.scale,
            replacementStartScale: replacementStart!.scale,
            replacementCompletedScale: replacementCompleted!.scale,
            expectedReplacementScale: def.replacementScale,
            paint,
            entryProof,
            events,
          });
        };

        /** Prepare a page at a rung's load, reset to settled 100%/custom. */
        const prepareP4bRung = async (
          rung: P4bRung
        ): Promise<{
          target: Page;
          ctx2: BrowserContext | null;
          entryProof: EntryProof;
        }> => {
          if (rung.dsf === 1) {
            await page.setViewportSize(rung.viewport);
            await openPdf(page, baseUrl, rung.fixture);
            await waitForProgressive(page);
            await waitForNonBlankCanvas(page);
            await ensureMetricsAttached(page);
            // The reset happens atomically INSIDE commitSettledEntryState, in
            // the same non-yielding in-page turn as the final quiescence
            // snapshot. There is deliberately no second metricsReset here:
            // reset runs exactly once, at the proven boundary.
            const entryProof = await commitSettledEntryState(page, 50_000);
            return { target: page, ctx2: null, entryProof };
          }
          // deviceScaleFactor is context-level: the DPR rung needs its own
          // context, still inside this same interception session.
          const ctx2 = await browser!.newContext({
            viewport: rung.viewport,
            deviceScaleFactor: rung.dsf,
            colorScheme: "dark",
          });
          const p2 = await ctx2.newPage();
          await openPdf(p2, baseUrl, rung.fixture);
          await waitForProgressive(p2);
          await waitForNonBlankCanvas(p2);
          await ensureMetricsAttached(p2);
          const entryProof = await commitSettledEntryState(p2, 50_000);
          return { target: p2, ctx2, entryProof };
        };

        // Climb the ladder until an overlap is genuinely observed.
        let winningRungIndex = -1;
        let firstDef: P4bRunDef | null = null;
        const ladderLog: Array<Record<string, unknown>> = [];
        for (let i = 0; i < P4B_LADDER.length; i++) {
          const rung = P4B_LADDER[i]!;
          const def = P4B_RUNS[rung.run as "A" | "C"];
          const { target, ctx2, entryProof } = await prepareP4bRung(rung);
          try {
            const outcome = await attemptP4bOnPage(target, def);
            ladderLog.push({
              rung: i,
              run: def.id,
              ...outcome,
              events: undefined,
              entryProof,
            });
            if (outcome.ok === true) {
              await assertP4bOracle(target, def, rung, i, outcome, entryProof);
              winningRungIndex = i;
              firstDef = def;
              break;
            }
          } finally {
            if (ctx2) {
              await ctx2.close();
            }
          }
        }
        if (winningRungIndex < 0 || !firstDef) {
          fail(
            `P-4b: exhausted the full escalation ladder without observing an in-flight overlap — ${JSON.stringify(ladderLog)}`
          );
        }

        // Run B at the rung where the first run succeeded, escalating the same
        // way if needed. Both runs must succeed — never one run repeated.
        let bDone = false;
        for (let i = winningRungIndex; i < P4B_LADDER.length; i++) {
          const rung = P4B_LADDER[i]!;
          const { target, ctx2, entryProof } = await prepareP4bRung(rung);
          try {
            const outcome = await attemptP4bOnPage(target, P4B_RUNS.B);
            ladderLog.push({
              rung: i,
              run: "B",
              ...outcome,
              events: undefined,
              entryProof,
            });
            if (outcome.ok === true) {
              await assertP4bOracle(
                target,
                P4B_RUNS.B,
                rung,
                i,
                outcome,
                entryProof
              );
              bDone = true;
              break;
            }
          } finally {
            if (ctx2) {
              await ctx2.close();
            }
          }
        }
        if (!bDone) {
          fail(
            `P-4b run B: exhausted the escalation ladder from rung ${winningRungIndex} — ${JSON.stringify(ladderLog)}`
          );
        }
        assert(
          p4bRuns.length >= 2,
          `P-4b: need >= 2 distinct overlapped runs, got ${p4bRuns.length}`
        );
        const distinctRunIds = new Set(
          p4bRuns.map((r) => (r as { run: string }).run)
        );
        assert(
          distinctRunIds.size >= 2,
          `P-4b: runs must be distinct, got ${[...distinctRunIds].join(",")}`
        );

        await page.setViewportSize({ width: 1380, height: 900 });
        await Bun.write(
          join(ARTIFACT_DIR, "p4b-ladder.json"),
          JSON.stringify(ladderLog, null, 2)
        );
        inter.p4b = p4bRuns;
        await Bun.write(
          join(ARTIFACT_DIR, "p4b-events.json"),
          JSON.stringify(p4bRuns, null, 2)
        );

        // ── P-5 canvas caps ────────────────────────────────────────────
        log("INTERCEPTION: P-5 canvas caps");
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        await ensureMetricsAttached(page);
        await metricsReset(page, 10_000);
        await zoomToPercent(page, 200);
        await waitForVisibleSettled(page);
        const p5Snap = await metricsSnapshot(page);
        assertDroppedZero(p5Snap, "P-5");
        const p5Starts = p5Snap.events.filter((e) => e.kind === "renderStart");
        const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
        const effectiveDpr = Math.min(Math.max(dpr, 1), MAX_DPR);
        for (const s of p5Starts) {
          if (s.canvasWidth == null || s.canvasHeight == null) {
            continue;
          }
          const area = s.canvasWidth * s.canvasHeight;
          assert(
            area <= MAX_CANVAS_PIXELS,
            `P-5 area ${area} exceeds cap ${MAX_CANVAS_PIXELS}`
          );
          // Effective DPR ≤ 2 × zoom: canvas dims should be ≈ css * min(dpr,2)
          if (s.scale != null) {
            // render scale includes dpr clamp; just record
          }
        }
        const liveCanvas = await page.evaluate(() => {
          const c = document.querySelector(
            'canvas.gno-pdf-canvas[data-gno-pdf-backing="1"]'
          ) as HTMLCanvasElement | null;
          return c
            ? { w: c.width, h: c.height, area: c.width * c.height }
            : null;
        });
        assert(liveCanvas, "P-5: no live backing canvas");
        assert(
          liveCanvas!.area <= MAX_CANVAS_PIXELS,
          `P-5 live area ${liveCanvas!.area} > cap`
        );
        inter.p5 = {
          devicePixelRatio: dpr,
          effectiveDpr,
          maxDpr: MAX_DPR,
          maxCanvasPixels: MAX_CANVAS_PIXELS,
          liveCanvas,
          starts: p5Starts.map((s) => ({
            w: s.canvasWidth,
            h: s.canvasHeight,
            scale: s.scale,
            area:
              s.canvasWidth != null && s.canvasHeight != null
                ? s.canvasWidth * s.canvasHeight
                : null,
          })),
        };
        await Bun.write(
          join(ARTIFACT_DIR, "p5-metrics.json"),
          JSON.stringify(await metricsExport(page), null, 2)
        );

        // ── P-6 destroy + silence ──────────────────────────────────────
        log("INTERCEPTION: P-6 destroy");
        await page.goto(`${baseUrl}/search`, {
          waitUntil: "domcontentloaded",
        });
        // Reset before load
        // Need metrics attached — open briefly then reset then open
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await waitForProgressive(page);
        await ensureMetricsAttached(page);
        await metricsReset(page, 20_000);
        await openPdf(page, baseUrl, "viewer-links.pdf");
        await waitForProgressive(page);
        await waitForNonBlankCanvas(page);
        const docIdP6 = await currentDocId(page);
        assert(docIdP6, "P-6: missing docId");
        const preDestroySnap = await metricsSnapshot(page);
        const preDestroySeq = preDestroySnap.seqHigh;

        // Navigate away WITHIN the SPA. `page.goto` is a real document
        // navigation that tears down the JS context, so the channel would be
        // gone by construction rather than by destroy — which proves nothing.
        // The contract is that the channel survives *unmount*, so drive the
        // app's own popstate router instead.
        await page.evaluate(() => {
          window.history.pushState({}, "", "/search");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="pdf-page-column"]') === null,
          null,
          { timeout: 15_000 }
        );
        // The channel must outlive the unmount by construction; its absence is
        // a product regression, not a reason to skip the oracle.
        assert(
          await page.evaluate(
            () =>
              (globalThis as unknown as { __gnoPdfMetrics?: unknown })
                .__gnoPdfMetrics !== undefined
          ),
          "P-6: __gnoPdfMetrics did not survive viewer unmount"
        );
        // Wait for documentDestroy
        await page
          .waitForFunction(
            (args) => {
              const m = (
                globalThis as unknown as {
                  __gnoPdfMetrics?: { snapshot: () => MetricsSnap };
                }
              ).__gnoPdfMetrics?.snapshot();
              if (!m) {
                return false;
              }
              return m.events.some(
                (e) =>
                  e.kind === "documentDestroy" &&
                  e.docId === args.docId &&
                  e.seq > args.preSeq
              );
            },
            { docId: docIdP6, preSeq: preDestroySeq },
            { timeout: 10_000 }
          )
          .catch(() => undefined);

        const destroySnap = await metricsSnapshot(page);
        const destroyEvent = destroySnap.events.find(
          (e) => e.kind === "documentDestroy" && e.docId === docIdP6
        );
        assert(destroyEvent, "P-6: no documentDestroy recorded");
        const destroySeq = destroyEvent!.seq;

        // Exact 1s silence window (mandated)
        await Bun.sleep(P6_SILENCE_MS);
        const p6 = await metricsSnapshot(page);
        assertDroppedZero(p6, "P-6");
        const lateStarts = p6.events.filter(
          (e) =>
            e.kind === "renderStart" &&
            e.docId === docIdP6 &&
            e.seq > destroySeq
        );
        if (lateStarts.length > 0) {
          fail(
            `P-6: ${lateStarts.length} renderStart for ${docIdP6} after destroy seq=${destroySeq}`
          );
        }
        inter.p6 = {
          docId: docIdP6,
          destroySeq,
          lateStarts: lateStarts.length,
          dropped: p6.dropped,
        };
        await Bun.write(
          join(ARTIFACT_DIR, "p6-metrics.json"),
          JSON.stringify(await metricsExport(page), null, 2)
        );

        // ── Visual QA dark/light × 1380/900 ────────────────────────────
        log("INTERCEPTION: visual QA matrix");
        const themeProbes: Record<
          string,
          {
            bodyBackground: string;
            bodyColor: string;
            backgroundVar: string;
            foregroundVar: string;
          }
        > = {};
        const themeRailSubjects: Record<
          string,
          {
            renderedCanvases: number;
            hasKnownGlyphRun: boolean;
            textLength: number;
          }
        > = {};
        for (const theme of ["dark", "light"] as const) {
          for (const width of [1380, 900] as const) {
            await page.setViewportSize({ width, height: 900 });
            await openPdf(page, baseUrl, "viewer-links.pdf");
            await waitForProgressive(page);
            await waitForNonBlankCanvas(page);

            // Theme MUST be applied AFTER navigation. `openPdf` performs a real
            // navigation, which discards any `data-theme` set beforehand — that
            // is exactly why every "light" capture was previously byte-identical
            // to its dark counterpart (Sol SOL6-R5-IMPL-01). The stylesheet is
            // driven by `[data-theme="light"]` on the document element, so that
            // attribute is the supported mechanism; we then WAIT until the
            // computed colors actually reflect the request rather than assuming
            // the paint has landed.
            const themeProbe = await page.evaluate(async (want: string) => {
              const root = document.documentElement;
              const read = () => {
                const bodyStyle = window.getComputedStyle(document.body);
                const rootStyle = window.getComputedStyle(root);
                return {
                  bodyBackground: bodyStyle.backgroundColor,
                  bodyColor: bodyStyle.color,
                  backgroundVar: rootStyle
                    .getPropertyValue("--background")
                    .trim(),
                  foregroundVar: rootStyle
                    .getPropertyValue("--foreground")
                    .trim(),
                };
              };
              const before = read();
              if (want === "light") {
                root.setAttribute("data-theme", "light");
              } else {
                root.setAttribute("data-theme", "dark");
              }
              // Wait for the computed custom properties to settle on the
              // requested theme (bounded; no fixed sleeps).
              const deadline = performance.now() + 5000;
              let now = read();
              for (;;) {
                const isLight = root.getAttribute("data-theme") === "light";
                // The light palette's --background differs from the dark one;
                // settle when the computed value stops changing AND matches the
                // requested attribute state.
                if (
                  root.getAttribute("data-theme") === (isLight ? "light" : want)
                ) {
                  const again = await new Promise<ReturnType<typeof read>>(
                    (r) => {
                      requestAnimationFrame(() => r(read()));
                    }
                  );
                  if (again.backgroundVar === now.backgroundVar) {
                    now = again;
                    break;
                  }
                  now = again;
                }
                if (performance.now() > deadline) {
                  break;
                }
                now = await new Promise<ReturnType<typeof read>>((r) => {
                  requestAnimationFrame(() => r(read()));
                });
              }
              return {
                requested: want,
                appliedAttribute: root.getAttribute("data-theme"),
                before,
                after: now,
              };
            }, theme);

            assert(
              themeProbe.appliedAttribute === theme,
              `visual matrix: data-theme did not persist after navigation (requested ${theme}, got ${themeProbe.appliedAttribute})`
            );
            themeProbes[`${theme}-w${width}`] = themeProbe.after;

            // Applying the theme can trigger a relayout/rerender that blanks
            // the canvas, and the earlier `waitForNonBlankCanvas` ran BEFORE the
            // theme was applied — so it could not witness that (Sol
            // SOL6-R6-IMPL-01: both light rail captures shipped blank canvases).
            // Re-establish the render AFTER the theme has settled, for every
            // theme and width, immediately before the rail capture.
            await waitForNonBlankCanvas(page, 20_000);
            const railSubject = await page.evaluate(() => {
              const rendered = document.querySelectorAll(
                '[data-rendered="true"] canvas.gno-pdf-canvas'
              );
              const layers = [
                ...document.querySelectorAll(".gno-pdf-text-layer"),
              ];
              const text = layers.map((l) => l.textContent ?? "").join(" ");
              return {
                renderedCanvases: rendered.length,
                hasKnownGlyphRun: text.includes("KNOWN_GLYPH_RUN_ALPHA"),
                textLength: text.trim().length,
              };
            });
            assert(
              railSubject.renderedCanvases >= 1 && railSubject.hasKnownGlyphRun,
              `visual matrix: rail capture subject not rendered for ${theme}/w${width} — the fixture page/text is absent (${JSON.stringify(railSubject)})`
            );
            themeRailSubjects[`${theme}-w${width}`] = railSubject;

            // Rail present
            const rail = await page.evaluate((w) => {
              const toolbar = document.querySelector(
                '[data-testid="pdf-toolbar"]'
              );
              const mobileBreak = document.querySelector(
                '[data-testid="pdf-toolbar-mobile-break"]'
              );
              const fitWidthLabel = document.querySelector(
                '[data-testid="pdf-toolbar-fit-width-label"]'
              );
              const fitPageLabel = document.querySelector(
                '[data-testid="pdf-toolbar-fit-page-label"]'
              );
              const labelVisible = (el: Element | null) => {
                if (!el) {
                  return false;
                }
                const style = window.getComputedStyle(el);
                return (
                  style.display !== "none" && style.visibility !== "hidden"
                );
              };
              return {
                toolbar: Boolean(toolbar),
                mobileBreakPresent: Boolean(mobileBreak),
                // At 900 (<lg), labels should be icon-only (hidden)
                fitWidthLabelVisible: labelVisible(fitWidthLabel),
                fitPageLabelVisible: labelVisible(fitPageLabel),
                width: w,
              };
            }, width);

            if (width === 900) {
              assert(
                rail.mobileBreakPresent,
                "narrow: missing pdf-toolbar-mobile-break for wrapped rail"
              );
              assert(
                !rail.fitWidthLabelVisible && !rail.fitPageLabelVisible,
                `narrow: fit labels should be icon-only, got ${JSON.stringify(rail)}`
              );
            }

            await shot(page, `visual-${theme}-w${width}-rail`, mode);

            // Overview + rails
            const surfaces = await page.evaluate(() => {
              // Mobile overview card: lg:hidden wrapper with "Overview" heading
              const overviewWrappers = [
                ...document.querySelectorAll(".lg\\:hidden"),
              ];
              let overview: Element | null = null;
              for (const w of overviewWrappers) {
                if (w.textContent?.includes("Overview")) {
                  overview = w;
                  break;
                }
              }
              const properties = document.querySelector(
                'nav[aria-label="Document properties"]'
              );
              const backlinks = document.querySelector(
                '[aria-label*="backlinks panel"], [aria-label*="Backlinks"]'
              );
              // Related notes: look for heading text or component markers
              const related =
                document.querySelector('[aria-label*="related" i]') ||
                [...document.querySelectorAll("h2,h3,button,div")].find((el) =>
                  /related notes/i.test(el.textContent ?? "")
                ) ||
                null;
              return {
                overview: Boolean(overview),
                overviewText: overview?.textContent?.slice(0, 120) ?? null,
                properties: Boolean(properties),
                backlinks: Boolean(backlinks),
                related: Boolean(related),
              };
            });

            if (width === 900) {
              assert(
                surfaces.overview,
                `mobile overview card missing for PDF (${theme}/${width})`
              );
            }
            // Properties/backlinks/related still in DOM for PDF docs
            assert(
              surfaces.properties,
              `Document properties rail missing for PDF (${theme}/${width})`
            );
            assert(
              surfaces.backlinks,
              `backlinks rail missing for PDF (${theme}/${width})`
            );
            assert(
              surfaces.related,
              `related notes surface missing for PDF (${theme}/${width}): ${JSON.stringify(surfaces)}`
            );

            // The `-overview` capture must actually DEPICT its subject. Without
            // scrolling, it was simply a second shot of the same viewport as
            // `-rail` (byte-identical at dark/w900), which is the same class of
            // misleading evidence as the theme defect. Scroll the intended
            // subject into view and PROVE it is on-screen at capture time:
            // at <lg the mobile overview card, at lg the properties rail (the
            // overview card is `lg:hidden` and legitimately absent there).
            const overviewShotProof = await page.evaluate((w: number) => {
              const wrappers = [...document.querySelectorAll(".lg\\:hidden")];
              let target: Element | null = null;
              if (w < 1024) {
                for (const el of wrappers) {
                  if (el.textContent?.includes("Overview")) {
                    target = el;
                    break;
                  }
                }
              }
              target ??= document.querySelector(
                'nav[aria-label="Document properties"]'
              );
              if (!target) {
                return {
                  found: false,
                  inViewport: false,
                  label: null,
                } as {
                  found: boolean;
                  inViewport: boolean;
                  label: string | null;
                  rect?: {
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                  };
                };
              }
              target.scrollIntoView({ block: "center" });
              return new Promise<{
                found: boolean;
                inViewport: boolean;
                label: string | null;
                rect?: {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                };
              }>((resolve) => {
                requestAnimationFrame(() => {
                  const r = (target as Element).getBoundingClientRect();
                  resolve({
                    found: true,
                    inViewport:
                      r.height > 0 &&
                      r.width > 0 &&
                      r.bottom > 0 &&
                      r.top < window.innerHeight,
                    label:
                      w < 1024 ? "mobile-overview-card" : "properties-rail",
                    // Document-relative box, for a clipped capture that depicts
                    // ONLY the subject.
                    rect: {
                      x: r.left + window.scrollX,
                      y: r.top + window.scrollY,
                      width: r.width,
                      height: r.height,
                    },
                  });
                });
              });
            }, width);

            assert(
              overviewShotProof.found && overviewShotProof.inViewport,
              `visual matrix: '-overview' capture subject not on screen for ${theme}/w${width} (${JSON.stringify(overviewShotProof)}) — the screenshot would not depict its subject`
            );

            inter[`visual_${theme}_${width}`] = {
              rail,
              surfaces,
              overviewShotProof,
            };
            // Clip to the proven subject box. A full-page capture here produced
            // a file byte-identical to the `-rail` capture whenever nothing
            // scrolled (dark/w900), which told a reviewer nothing about the
            // overview card. Clipping makes the artifact depict its subject.
            await shotClip(
              page,
              `visual-${theme}-w${width}-overview`,
              mode,
              overviewShotProof.rect
            );
          }
        }

        // ── Visual-matrix non-vacuity (Sol SOL6-R5-IMPL-01) ────────────────
        // Two independent checks, neither relying on fragile pixel sampling:
        //   (a) the COMPUTED theme values must differ between dark and light at
        //       each width — proves the stylesheet actually switched;
        //   (b) each paired dark/light screenshot must differ by content hash —
        //       proves the captured artifact reflects that switch. Previously
        //       every light PNG was byte-identical to its dark counterpart.
        inter.themeProbes = themeProbes;
        inter.themeRailSubjects = themeRailSubjects;
        for (const width of [1380, 900] as const) {
          const dark = themeProbes[`dark-w${width}`];
          const light = themeProbes[`light-w${width}`];
          assert(
            Boolean(dark) && Boolean(light),
            `visual matrix: missing theme probe for width ${width}`
          );
          assert(
            dark!.backgroundVar !== light!.backgroundVar &&
              dark!.bodyBackground !== light!.bodyBackground,
            `visual matrix: dark and light computed values are identical at ${width} (dark=${JSON.stringify(dark)} light=${JSON.stringify(light)})`
          );
        }

        const themeShotHashes: Record<string, string> = {};
        for (const width of [1380, 900] as const) {
          for (const variant of ["rail", "overview"] as const) {
            const pair: Record<string, string> = {};
            for (const theme of ["dark", "light"] as const) {
              const name = `INTERCEPTION__visual-${theme}-w${width}-${variant}.png`;
              const bytes = await Bun.file(join(ARTIFACT_DIR, name)).bytes();
              const hash = new Bun.CryptoHasher("sha256")
                .update(bytes)
                .digest("hex");
              pair[theme] = hash;
              themeShotHashes[name] = hash;
            }
            assert(
              pair.dark !== pair.light,
              `visual matrix: light capture is byte-identical to dark for w${width}-${variant} (sha256 ${pair.dark}) — the theme did not reach the screenshot`
            );
          }
        }
        inter.themeScreenshotHashes = themeShotHashes;
        await Bun.write(
          join(ARTIFACT_DIR, "visual-theme-proof.json"),
          JSON.stringify(
            {
              themeProbes,
              themeRailSubjects,
              screenshotHashes: themeShotHashes,
            },
            null,
            2
          )
        );

        // App never crashed
        assert(
          await page.evaluate(() => Boolean(document.body)),
          "app crashed (no body)"
        );

        evidence.modes.INTERCEPTION = inter;
        evidence.commands.push({
          name: "INTERCEPTION",
          ok: evidence.failures.length === 0,
        });
        log("INTERCEPTION complete");
      } finally {
        await ctx.close();
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (server) {
      server.kill();
      await server.exited.catch(() => undefined);
    }
    if (serverLogs) {
      await serverLogs.drain().catch(() => undefined);
      // Persist bounded server logs for post-mortem (always, not only on fail).
      try {
        await Bun.write(
          join(ARTIFACT_DIR, "server-stdout.log"),
          serverLogs.stdout || ""
        );
        await Bun.write(
          join(ARTIFACT_DIR, "server-stderr.log"),
          serverLogs.stderr || ""
        );
      } catch {
        // artifact dir may not exist yet in early failures
      }
    }
    process.env.GNO_CONFIG_DIR = originalEnv.GNO_CONFIG_DIR;
    process.env.GNO_DATA_DIR = originalEnv.GNO_DATA_DIR;
    process.env.GNO_CACHE_DIR = originalEnv.GNO_CACHE_DIR;
    process.env.GNO_OFFLINE = originalEnv.GNO_OFFLINE;
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // Persist logs + evidence
  await Bun.write(
    join(ARTIFACT_DIR, "request-log.json"),
    JSON.stringify(requestLogs, null, 2)
  );
  await Bun.write(
    join(ARTIFACT_DIR, "console-log.json"),
    JSON.stringify(consoleLogs, null, 2)
  );
  evidence.machine.finishedAt = new Date().toISOString();
  await Bun.write(
    join(ARTIFACT_DIR, "evidence.json"),
    JSON.stringify(evidence, null, 2)
  );

  await hashArtifacts();
  await Bun.write(
    join(ARTIFACT_DIR, "artifact-hashes.json"),
    JSON.stringify(evidence.artifactHashes, null, 2)
  );

  const indexMd = [
    "# fn-112 task .6 PDF viewer smoke — artifact index",
    "",
    `- Started: ${evidence.machine.startedAt}`,
    `- Finished: ${evidence.machine.finishedAt}`,
    `- Platform: ${evidence.machine.platform}/${evidence.machine.arch} Bun ${evidence.machine.bun}`,
    `- Failures: ${evidence.failures.length}`,
    "",
    "## Screenshots",
    ...evidence.screenshots.map((s) => `- \`${s.replace(`${ROOT}/`, "")}\``),
    "",
    "## Modes",
    `- CLEAN: ${JSON.stringify(evidence.commands.find((c) => c.name === "CLEAN"))}`,
    `- INTERCEPTION: ${JSON.stringify(evidence.commands.find((c) => c.name === "INTERCEPTION"))}`,
    "",
    "## Artifact hashes (sha256)",
    ...Object.entries(evidence.artifactHashes).map(
      ([f, h]) => `- \`${f}\`: \`${h}\``
    ),
    "",
    "## Failures",
    ...(evidence.failures.length
      ? evidence.failures.map((f) => `- ${f}`)
      : ["- (none)"]),
    "",
  ].join("\n");
  await Bun.write(join(ARTIFACT_DIR, "INDEX.md"), indexMd);

  if (evidence.failures.length > 0) {
    console.error("PDF viewer smoke FAILED:");
    for (const f of evidence.failures) {
      console.error(`  - ${f}`);
    }
    process.exitCode = 1;
    return;
  }
  if (evidence.budgetFailures.length > 0) {
    // Thresholds are never relaxed: a recorded budget miss still fails the run.
    // Deferring to here only preserves the downstream evidence artifacts.
    log(
      `PDF viewer smoke FAILED — ${evidence.budgetFailures.length} budget failure(s):`
    );
    for (const f of evidence.budgetFailures) {
      log(`  - ${f}`);
    }
    process.exitCode = 1;
    return;
  }
  log("PDF viewer smoke PASSED");
}

await main();
