/**
 * Production-route tests for fn-112 doc-asset + vendor surfaces (I1-04 rereview).
 * Invokes the same factories server.ts mounts — no duplicated route maps, no port bind.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../../src/config/types";
import type { ResidentRuntime } from "../../src/serve/resident-runtime";
import type { DocumentRow } from "../../src/store/types";

import {
  createDocAssetRouteHandlers,
  handlePdfjsVendorRequest,
  isPdfjsVendorPath,
  PDFJS_VENDOR_ERRORS,
} from "../../src/serve/fn112-routes";
import { PDFJS_ASSET_CACHE_CONTROL } from "../../src/serve/pdfjs-assets";
import { ReaderGate } from "../../src/serve/resident-admission";
import { DOC_ASSET_CACHE_CONTROL } from "../../src/serve/routes/api";
import { withSecurityHeaders } from "../../src/serve/server";
import { safeRm } from "../helpers/cleanup";

/** Same options object server.ts passes to handlePdfjsVendorRequest. */
const vendorDispatchOptions = {
  isDev: false,
  withSecurityHeaders,
} as const;

function createConfig(root: string): Config {
  return {
    version: "1.0",
    ftsTokenizer: "unicode61",
    collections: [
      {
        name: "reading",
        path: root,
        pattern: "**/*",
        include: [],
        exclude: [],
      },
    ],
    contexts: [],
  };
}

function createDoc(relPath: string): DocumentRow {
  return {
    id: 1,
    collection: "reading",
    relPath,
    sourceHash: "hash",
    sourceMime: "text/markdown",
    sourceExt: ".md",
    sourceSize: 100,
    sourceMtime: new Date().toISOString(),
    docid: "#doc",
    uri: "gno://reading/notes/doc.md",
    title: "doc",
    mirrorHash: "mirror",
    converterId: null,
    converterVersion: null,
    languageHint: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorAt: null,
    active: true,
    ingestVersion: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Minimal ResidentRuntime stub exercising handleResidentRead. */
function createRuntimeStub(opts?: {
  admit?: boolean;
  readerFull?: boolean;
}): ResidentRuntime {
  const admit = opts?.admit !== false;
  const readerGate = new ReaderGate(
    opts?.readerFull ? 0 : 8,
    opts?.readerFull ? 0 : 64
  );
  // ReaderGate with limit 0 is awkward — use mock acquire instead when full
  const gate = opts?.readerFull
    ? {
        acquire: async () => {
          throw new Error("Resident reader queue is full");
        },
      }
    : readerGate;

  return {
    admitRequest: (signal?: AbortSignal) => {
      if (!admit) return null;
      const controller = new AbortController();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      return {
        signal: controller.signal,
        finish: () => undefined,
        authorizationEpoch: "epoch-1",
        isAuthorizationEpochCurrent: () => true,
      };
    },
    readerGate: gate as ReaderGate,
    withModelLease: async <T>(operation: () => Promise<T>) => operation(),
  } as unknown as ResidentRuntime;
}

function createStore(doc: DocumentRow) {
  return {
    getDocumentByUri(uri: string) {
      return Promise.resolve({
        ok: true as const,
        value: uri === doc.uri ? doc : null,
      });
    },
  };
}

function assertSecurityEnvelope(res: Response): void {
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("unsafe-eval");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
}

async function assertExactJsonError(
  res: Response,
  status: number,
  expected: { code: string; message: string }
): Promise<void> {
  expect(res.status).toBe(status);
  assertSecurityEnvelope(res);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("application/json");
  const json = (await res.json()) as {
    error: { code: string; message: string };
  };
  expect(json).toEqual({ error: { ...expected } });
}

function assertDocAssetEnvelope(
  res: Response,
  opts: {
    status: number;
    contentRange?: string | null;
  }
): void {
  expect(res.status).toBe(opts.status);
  expect(res.headers.get("accept-ranges")).toBe("bytes");
  expect(res.headers.get("cache-control")).toBe(DOC_ASSET_CACHE_CONTROL);
  expect(res.headers.get("content-disposition")).toContain("inline;");
  expect(res.headers.get("content-type")).toBeTruthy();
  if (opts.contentRange !== undefined) {
    expect(res.headers.get("content-range")).toBe(opts.contentRange);
  }
  assertSecurityEnvelope(res);
}

describe("production /api/doc-asset routes (shared factory)", () => {
  let tmpDir: string;
  let body: string;
  let assetUrl: string;
  let handlers: ReturnType<typeof createDocAssetRouteHandlers>;
  let runtime: ResidentRuntime;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gno-prod-doc-asset-"));
    body = "0123456789";
    const notesDir = join(tmpDir, "notes");
    await mkdir(notesDir, { recursive: true });
    await writeFile(join(notesDir, "doc.md"), "# note");
    await writeFile(join(notesDir, "asset.bin"), body);
    const doc = createDoc("notes/doc.md");
    const store = createStore(doc);
    const config = createConfig(tmpDir);
    runtime = createRuntimeStub({ admit: true });
    handlers = createDocAssetRouteHandlers({
      store: store as never,
      getConfig: () => config,
      runtime,
      isDev: false,
      withSecurityHeaders,
    });
    assetUrl = `http://127.0.0.1/api/doc-asset?uri=${encodeURIComponent(doc.uri)}&path=asset.bin`;
  });

  afterEach(async () => {
    await safeRm(tmpDir);
  });

  test("GET and HEAD share admission path — denied admit → 503 UNAVAILABLE", async () => {
    const denied = createDocAssetRouteHandlers({
      store: createStore(createDoc("notes/doc.md")) as never,
      getConfig: () => createConfig(tmpDir),
      runtime: createRuntimeStub({ admit: false }),
      isDev: false,
      withSecurityHeaders,
    });
    for (const method of ["GET", "HEAD"] as const) {
      const res = await denied[method](new Request(assetUrl, { method }));
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("UNAVAILABLE");
      assertSecurityEnvelope(res);
    }
  });

  test("GET and HEAD share admission path — reader full → 429 RATE_LIMITED", async () => {
    const full = createDocAssetRouteHandlers({
      store: createStore(createDoc("notes/doc.md")) as never,
      getConfig: () => createConfig(tmpDir),
      runtime: createRuntimeStub({ admit: true, readerFull: true }),
      isDev: false,
      withSecurityHeaders,
    });
    for (const method of ["GET", "HEAD"] as const) {
      const res = await full[method](new Request(assetUrl, { method }));
      expect(res.status).toBe(429);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("RATE_LIMITED");
      assertSecurityEnvelope(res);
    }
  });

  test("production GET/HEAD matrix: 200/206/416 complete envelope + empty HEAD", async () => {
    const total = body.length;
    const cases: Array<{
      method: "GET" | "HEAD";
      range?: string;
      status: number;
      contentRange?: string;
      expectBody: string;
    }> = [
      { method: "GET", status: 200, expectBody: body },
      { method: "HEAD", status: 200, expectBody: "" },
      {
        method: "GET",
        range: "bytes=0-4",
        status: 206,
        contentRange: `bytes 0-4/${total}`,
        expectBody: "01234",
      },
      {
        method: "HEAD",
        range: "bytes=0-4",
        status: 206,
        contentRange: `bytes 0-4/${total}`,
        expectBody: "",
      },
      {
        method: "GET",
        range: "bytes=5-",
        status: 206,
        contentRange: `bytes 5-9/${total}`,
        expectBody: "56789",
      },
      {
        method: "HEAD",
        range: "bytes=5-",
        status: 206,
        contentRange: `bytes 5-9/${total}`,
        expectBody: "",
      },
      {
        method: "GET",
        range: "bytes=-3",
        status: 206,
        contentRange: `bytes 7-9/${total}`,
        expectBody: "789",
      },
      {
        method: "HEAD",
        range: "bytes=-3",
        status: 206,
        contentRange: `bytes 7-9/${total}`,
        expectBody: "",
      },
      {
        method: "GET",
        range: "bytes=abc",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
      {
        method: "HEAD",
        range: "bytes=abc",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
      {
        method: "GET",
        range: "bytes=0-1,2-3",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
      {
        method: "HEAD",
        range: "bytes=0-1,2-3",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
      {
        method: "GET",
        range: "bytes=100-200",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
      {
        method: "HEAD",
        range: "bytes=100-200",
        status: 416,
        contentRange: `bytes */${total}`,
        expectBody: "",
      },
    ];

    for (const c of cases) {
      const req = new Request(assetUrl, {
        method: c.method,
        headers: c.range ? { Range: c.range } : undefined,
      });
      const res = await handlers[c.method](req);
      assertDocAssetEnvelope(res, {
        status: c.status,
        contentRange: c.contentRange,
      });
      const text = await res.text();
      expect(text).toBe(c.expectBody);
      if (c.method === "HEAD") {
        expect(text).toBe("");
      }
    }
  });

  test("GET vs HEAD header equality for 200/206/416 via production handlers", async () => {
    for (const range of [
      undefined,
      "bytes=0-3",
      "bytes=0-1,2-3",
      "bytes=abc",
    ]) {
      const getRes = await handlers.GET(
        new Request(assetUrl, {
          method: "GET",
          headers: range ? { Range: range } : undefined,
        })
      );
      const headRes = await handlers.HEAD(
        new Request(assetUrl, {
          method: "HEAD",
          headers: range ? { Range: range } : undefined,
        })
      );
      expect(headRes.status).toBe(getRes.status);
      for (const h of [
        "accept-ranges",
        "cache-control",
        "content-disposition",
        "content-type",
        "content-range",
        "content-length",
        "content-security-policy",
        "x-frame-options",
      ]) {
        expect(headRes.headers.get(h)).toBe(getRes.headers.get(h));
      }
      expect(await headRes.text()).toBe("");
      await getRes.arrayBuffer();
    }
  });
});

describe("production /vendor/pdfjs dispatcher (handlePdfjsVendorRequest — same as server fetch)", () => {
  test("isPdfjsVendorPath claims the whole production prefix", () => {
    expect(isPdfjsVendorPath("/vendor/pdfjs")).toBe(true);
    expect(isPdfjsVendorPath("/vendor/pdfjs/")).toBe(true);
    expect(isPdfjsVendorPath("/vendor/pdfjs/pdf.worker.min.mjs")).toBe(true);
    expect(isPdfjsVendorPath("/vendor/pdfjs/pdf.worker.raw.min.mjs")).toBe(
      true
    );
    expect(isPdfjsVendorPath("/vendor/pdfjs/cmaps/x.bcmap")).toBe(true);
    expect(isPdfjsVendorPath("/vendor/pdfjs/cmaps/a/b")).toBe(true);
    expect(isPdfjsVendorPath("/api/doc-asset")).toBe(false);
    expect(isPdfjsVendorPath("/vendor/other")).toBe(false);
  });

  test("worker/cMap/font GET+HEAD: immutable cache, MIME, security, empty HEAD", async () => {
    const surfaces = [
      {
        path: "/vendor/pdfjs/pdf.worker.min.mjs",
        ct: "text/javascript",
      },
      {
        path: "/vendor/pdfjs/pdf.worker.raw.min.mjs",
        ct: "text/javascript",
      },
      {
        path: "/vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap",
        ct: "application/octet-stream",
      },
      {
        path: "/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
        ct: "font/ttf",
      },
    ];

    for (const s of surfaces) {
      const getRes = await handlePdfjsVendorRequest(
        new Request(`http://127.0.0.1${s.path}`, { method: "GET" }),
        vendorDispatchOptions
      );
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toBe(s.ct);
      expect(getRes.headers.get("cache-control")).toBe(
        PDFJS_ASSET_CACHE_CONTROL
      );
      expect(getRes.headers.get("cache-control")).toContain("immutable");
      assertSecurityEnvelope(getRes);
      const getBody = await getRes.arrayBuffer();
      expect(getBody.byteLength).toBeGreaterThan(10);

      const headRes = await handlePdfjsVendorRequest(
        new Request(`http://127.0.0.1${s.path}`, { method: "HEAD" }),
        vendorDispatchOptions
      );
      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("cache-control")).toBe(
        PDFJS_ASSET_CACHE_CONTROL
      );
      assertSecurityEnvelope(headRes);
      expect(Number(headRes.headers.get("content-length"))).toBe(
        getBody.byteLength
      );
      expect(await headRes.text()).toBe("");
    }
  });

  test("POST on valid vendor path → exact 405 envelope + security headers", async () => {
    const post = await handlePdfjsVendorRequest(
      new Request("http://127.0.0.1/vendor/pdfjs/pdf.worker.min.mjs", {
        method: "POST",
      }),
      vendorDispatchOptions
    );
    await assertExactJsonError(
      post,
      405,
      PDFJS_VENDOR_ERRORS.METHOD_NOT_ALLOWED
    );
  });

  test("malformed/unknown paths → exact 404 NOT_FOUND envelope + security headers", async () => {
    const badPaths = [
      "/vendor/pdfjs/cmaps/../build/pdf.worker.min.mjs",
      "/vendor/pdfjs/cmaps/%2e%2e%2fbuild%2fpdf.worker.min.mjs",
      "/vendor/pdfjs/cmaps/a/b.bcmap",
      "/vendor/pdfjs/cmaps/",
      "/vendor/pdfjs/",
      "/vendor/pdfjs",
      "/vendor/pdfjs/standard_fonts/evil.js",
      "/vendor/pdfjs/cmaps/nope.bcmap",
      "/vendor/pdfjs/cmaps/%E0%A4%A", // invalid UTF-8 percent encoding
      "/vendor/pdfjs/unknown/path",
      "/vendor/pdfjs/standard_fonts/",
    ];

    for (const path of badPaths) {
      const res = await handlePdfjsVendorRequest(
        new Request(`http://127.0.0.1${path}`, { method: "GET" }),
        vendorDispatchOptions
      );
      await assertExactJsonError(res, 404, PDFJS_VENDOR_ERRORS.NOT_FOUND);
    }
  });

  test("POST on malformed path also returns exact 405 (method check first)", async () => {
    const res = await handlePdfjsVendorRequest(
      new Request("http://127.0.0.1/vendor/pdfjs/cmaps/a/b.bcmap", {
        method: "POST",
      }),
      vendorDispatchOptions
    );
    await assertExactJsonError(
      res,
      405,
      PDFJS_VENDOR_ERRORS.METHOD_NOT_ALLOWED
    );
  });
});
