/**
 * Production route factories for fn-112 doc-asset + pdfjs vendor surfaces.
 * server.ts and tests MUST consume these — no duplicated route maps.
 *
 * Vendor: ONE production dispatcher (`handlePdfjsVendorRequest`) is the sole
 * path for every /vendor/pdfjs/* request (valid or malformed, any method).
 * server.ts routes that prefix through fetch; tests call the same function.
 */

import type { Config } from "../config/types";
import type { SqliteAdapter } from "../store/sqlite/adapter";
import type { ResidentRuntime } from "./resident-runtime";

import { handlePdfjsAsset } from "./pdfjs-assets";
import { handleResidentRead } from "./resident-request";
import { handleDocAsset } from "./routes/api";

export type SecurityHeaderWrap = (
  response: Response,
  isDev: boolean
) => Response;

export type DocAssetRouteContext = {
  store: SqliteAdapter;
  /** Live config getter (ctxHolder.config may change). */
  getConfig: () => Config;
  runtime: ResidentRuntime;
  isDev: boolean;
  withSecurityHeaders: SecurityHeaderWrap;
};

export type MethodHandlers = {
  GET: (req: Request) => Promise<Response> | Response;
  HEAD: (req: Request) => Promise<Response> | Response;
};

/** Exact production error envelopes for vendor routes (I1-04 round 3). */
export const PDFJS_VENDOR_ERRORS = {
  NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Asset not found",
  },
  METHOD_NOT_ALLOWED: {
    code: "METHOD_NOT_ALLOWED",
    message: "Only GET and HEAD are supported",
  },
} as const;

/**
 * Production `/api/doc-asset` GET+HEAD handlers.
 * Both methods traverse handleResidentRead (admission) then withSecurityHeaders.
 */
export function createDocAssetRouteHandlers(
  ctx: DocAssetRouteContext
): MethodHandlers {
  const dispatch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    return ctx.withSecurityHeaders(
      await handleResidentRead(ctx.runtime, req, () =>
        handleDocAsset(ctx.store, ctx.getConfig(), url, req)
      ),
      ctx.isDev
    );
  };
  return {
    GET: dispatch,
    HEAD: dispatch,
  };
}

export type PdfjsVendorDispatchOptions = {
  isDev: boolean;
  withSecurityHeaders: SecurityHeaderWrap;
};

/**
 * Production vendor dispatcher — the ONLY production path for `/vendor/pdfjs/*`.
 *
 * Handles every method and every pathname under the prefix (worker, cmaps,
 * standard_fonts, multi-segment, empty, encoded traversal, invalid encoding).
 * ALL responses — success, 404, 405 — go through withSecurityHeaders exactly once.
 *
 * server.ts must call this for the prefix (via fetch); tests must call this
 * identical function (no separate test-only fallback).
 */
export async function handlePdfjsVendorRequest(
  request: Request,
  options: PdfjsVendorDispatchOptions
): Promise<Response> {
  const wrap = options.withSecurityHeaders;
  const isDev = options.isDev;
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;

  // Never double-wrap: build the inner response, then wrap once.
  const inner = await dispatchPdfjsVendorInner(method, pathname);
  return wrap(inner, isDev);
}

/**
 * True when this request should be handled by the vendor dispatcher.
 * Used by server fetch to claim the whole prefix.
 */
export function isPdfjsVendorPath(pathname: string): boolean {
  return pathname === "/vendor/pdfjs" || pathname.startsWith("/vendor/pdfjs/");
}

async function dispatchPdfjsVendorInner(
  method: string,
  pathname: string
): Promise<Response> {
  // Only GET/HEAD are ever valid on any vendor path
  if (method !== "GET" && method !== "HEAD") {
    return methodNotAllowedResponse();
  }

  // Exact worker
  if (pathname === "/vendor/pdfjs/pdf.worker.min.mjs") {
    return handlePdfjsAsset({ kind: "worker", method });
  }

  // cmaps/:file — single segment only
  const cmapMatch = pathname.match(/^\/vendor\/pdfjs\/cmaps\/([^/]*)$/u);
  if (cmapMatch) {
    const raw = cmapMatch[1] ?? "";
    if (raw === "") {
      return notFoundResponse();
    }
    const file = decodeRouteSegment(raw);
    if (file === null) {
      return notFoundResponse();
    }
    return handlePdfjsAsset({ kind: "cmaps", file, method });
  }

  // standard_fonts/:file — single segment only
  const fontMatch = pathname.match(
    /^\/vendor\/pdfjs\/standard_fonts\/([^/]*)$/u
  );
  if (fontMatch) {
    const raw = fontMatch[1] ?? "";
    if (raw === "") {
      return notFoundResponse();
    }
    const file = decodeRouteSegment(raw);
    if (file === null) {
      return notFoundResponse();
    }
    return handlePdfjsAsset({ kind: "standard_fonts", file, method });
  }

  // Multi-segment, empty prefix, unknown subpaths, traversal that doesn't
  // collapse to a single-segment match → 404
  return notFoundResponse();
}

function decodeRouteSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function notFoundResponse(): Response {
  return Response.json(
    { error: { ...PDFJS_VENDOR_ERRORS.NOT_FOUND } },
    { status: 404 }
  );
}

function methodNotAllowedResponse(): Response {
  return Response.json(
    { error: { ...PDFJS_VENDOR_ERRORS.METHOD_NOT_ALLOWED } },
    { status: 405 }
  );
}

/**
 * @deprecated Use handlePdfjsVendorRequest — kept only if any import remains.
 * Prefer the single production dispatcher.
 */
export async function dispatchPdfjsVendorRoute(
  _routeMap: unknown,
  request: Request,
  options?: PdfjsVendorDispatchOptions
): Promise<Response> {
  if (!options) {
    throw new Error(
      "dispatchPdfjsVendorRoute requires production options; use handlePdfjsVendorRequest"
    );
  }
  return handlePdfjsVendorRequest(request, options);
}
