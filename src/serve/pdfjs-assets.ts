/**
 * Same-origin serving of pinned pdfjs-dist assets (worker, cMaps, standard fonts).
 *
 * Security model (I1-01 / Sol):
 * - Independently resolve and canonicalize the installed pdfjs-dist package root.
 * - Every candidate (worker / cMap / font) must realpath inside that package root
 *   AND inside the expected subdirectory (build/, cmaps/, standard_fonts/).
 * - Never trust an injectable path resolver as both candidate and root authority.
 * - Fail closed on package-root resolution failure and non-ENOENT realpath errors.
 * - Lazy per-request resolve so a broken install degrades to 404, never startup crash.
 */

// node:fs/promises — no Bun equivalent for realpath
import { realpath } from "node:fs/promises";
// node:path — no Bun equivalent for path resolution / containment
import nodePath from "node:path";

/** cMaps allowlist: packed binary cMaps only (Sol N18). */
const CMAP_EXTENSIONS = new Set([".bcmap"]);

/**
 * Standard-font extensions actually shipped by pdfjs-dist@5.7.284:
 * Foxit*.pfb and LiberationSans*.ttf (LICENSE_* files are not served).
 */
const STANDARD_FONT_EXTENSIONS = new Set([".pfb", ".ttf"]);

/** Immutable long-cache for version-pinned package assets (I1-01). */
export const PDFJS_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type PdfjsAssetKind = "worker" | "cmaps" | "standard_fonts";

export type RealpathFn = (path: string) => Promise<string>;

function error404(message: string): Response {
  return Response.json(
    {
      error: {
        code: "NOT_FOUND",
        message,
      },
    },
    { status: 404 }
  );
}

function fileUrlToPath(url: string): string {
  return url.startsWith("file:") ? new URL(url).pathname : url;
}

/**
 * Independently resolve the installed pdfjs-dist package root via package.json,
 * then canonicalize with realpath. Fail closed (null) on any error.
 */
export async function resolvePdfjsPackageRoot(
  realpathFn: RealpathFn = realpath
): Promise<string | null> {
  try {
    const pkgUrl = import.meta.resolve("pdfjs-dist/package.json");
    const pkgPath = fileUrlToPath(pkgUrl);
    const root = nodePath.dirname(pkgPath);
    return await realpathFn(root);
  } catch {
    return null;
  }
}

/**
 * Expected absolute subdirectory under a package root for each asset kind.
 */
export function expectedSubdirForKind(
  packageRoot: string,
  kind: PdfjsAssetKind
): string {
  if (kind === "worker") {
    return nodePath.join(packageRoot, "build");
  }
  if (kind === "cmaps") {
    return nodePath.join(packageRoot, "cmaps");
  }
  return nodePath.join(packageRoot, "standard_fonts");
}

/**
 * Validate a single path segment for cmap/font filenames.
 * Rejects empty, multi-segment, `..`, and disallowed extensions.
 */
export function isSafePdfjsAssetFilename(
  file: string,
  kind: "cmaps" | "standard_fonts"
): boolean {
  if (
    !file ||
    file.includes("/") ||
    file.includes("\\") ||
    file.includes("\0") ||
    file.includes("..")
  ) {
    return false;
  }
  if (file === "." || file === "..") {
    return false;
  }
  // Reject percent-encoded traversal attempts that survive route decoding
  let decoded = file;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return false;
  }
  if (
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("..")
  ) {
    return false;
  }
  const ext = nodePath.extname(decoded).toLowerCase();
  if (kind === "cmaps") {
    return CMAP_EXTENSIONS.has(ext);
  }
  return STANDARD_FONT_EXTENSIONS.has(ext);
}

export function contentTypeForPdfjsAsset(
  kind: PdfjsAssetKind,
  file?: string
): string {
  if (kind === "worker") {
    return "text/javascript";
  }
  if (kind === "standard_fonts" && file) {
    const ext = nodePath.extname(file).toLowerCase();
    if (ext === ".ttf") {
      return "font/ttf";
    }
    if (ext === ".pfb") {
      return "application/octet-stream";
    }
  }
  return "application/octet-stream";
}

/**
 * Resolve a candidate on-disk path for an asset via import.meta.resolve.
 * This is ONLY a candidate locator — containment is decided solely against the
 * independently resolved package root (never against this resolver's "dir").
 */
export type PdfjsCandidateResolver = (
  kind: PdfjsAssetKind,
  file?: string
) => Promise<string | null>;

export const defaultPdfjsCandidateResolver: PdfjsCandidateResolver = async (
  kind,
  file
) => {
  try {
    if (kind === "worker") {
      const url = import.meta.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
      return fileUrlToPath(url);
    }
    if (kind === "cmaps") {
      if (!file) {
        return null;
      }
      // Resolve sample to find package layout, then join requested file name only
      const sample = import.meta
        .resolve("pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap");
      const samplePath = fileUrlToPath(sample);
      return nodePath.join(nodePath.dirname(samplePath), file);
    }
    if (!file) {
      return null;
    }
    const sample = import.meta
      .resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");
    const samplePath = fileUrlToPath(sample);
    return nodePath.join(nodePath.dirname(samplePath), file);
  } catch {
    return null;
  }
};

/**
 * True iff candidate is strictly contained in root after realpath of both.
 * non-ENOENT realpath errors fail closed. ENOENT on candidate → lexical check
 * only (for missing-file 404 paths that still must not escape).
 */
export async function isContainedInRoot(
  root: string,
  candidate: string,
  realpathFn: RealpathFn = realpath
): Promise<boolean> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpathFn(root);
  } catch {
    return false;
  }

  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpathFn(candidate);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT") {
      const rel = nodePath.relative(resolvedRoot, candidate);
      return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
    }
    // EACCES, ELOOP, etc. fail closed
    return false;
  }

  const rel = nodePath.relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
}

export type HandlePdfjsAssetOptions = {
  kind: PdfjsAssetKind;
  file?: string;
  method?: string;
  /** Candidate path locator only — NOT used as containment authority. */
  resolveCandidate?: PdfjsCandidateResolver;
  /** Independently resolve package root (defaults to resolvePdfjsPackageRoot). */
  resolvePackageRoot?: () => Promise<string | null>;
  realpathFn?: RealpathFn;
};

function assetHeaders(
  kind: PdfjsAssetKind,
  fileName: string | undefined,
  size: number
): Headers {
  return new Headers({
    "Content-Type": contentTypeForPdfjsAsset(kind, fileName),
    "Cache-Control": PDFJS_ASSET_CACHE_CONTROL,
    "Content-Length": String(size),
  });
}

/**
 * Serve a pdfjs-dist asset. GET returns body; HEAD returns headers with empty body.
 */
export async function handlePdfjsAsset(
  options: HandlePdfjsAssetOptions
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return Response.json(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only GET and HEAD are supported",
        },
      },
      { status: 405 }
    );
  }

  const realpathFn = options.realpathFn ?? realpath;
  const resolveRoot =
    options.resolvePackageRoot ?? (() => resolvePdfjsPackageRoot(realpathFn));
  const resolveCandidate =
    options.resolveCandidate ?? defaultPdfjsCandidateResolver;

  // Independent package-root authority — fail closed if unavailable
  const packageRoot = await resolveRoot();
  if (!packageRoot) {
    return error404("pdfjs package not found");
  }

  const expectedDir = expectedSubdirForKind(packageRoot, options.kind);

  if (options.kind === "worker") {
    const candidate = await resolveCandidate("worker");
    if (!candidate) {
      return error404("pdfjs worker not found");
    }
    // Must sit inside package root AND build/
    if (!(await isContainedInRoot(packageRoot, candidate, realpathFn))) {
      return error404("pdfjs worker not found");
    }
    if (!(await isContainedInRoot(expectedDir, candidate, realpathFn))) {
      return error404("pdfjs worker not found");
    }
    // Prefer realpath for open
    let openPath = candidate;
    try {
      openPath = await realpathFn(candidate);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code === "ENOENT") {
        return error404("pdfjs worker not found");
      }
      return error404("pdfjs worker not found");
    }

    const file = Bun.file(openPath);
    if (!(await file.exists())) {
      return error404("pdfjs worker not found");
    }
    const headers = assetHeaders("worker", undefined, file.size);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(file, { headers });
  }

  const fileName = options.file ?? "";
  if (
    !isSafePdfjsAssetFilename(
      fileName,
      options.kind === "cmaps" ? "cmaps" : "standard_fonts"
    )
  ) {
    return error404("Asset not found");
  }

  // Build candidate only from package-root + expected subdir + single segment
  // (do not trust resolver output alone)
  const safeName = (() => {
    try {
      return decodeURIComponent(fileName);
    } catch {
      return null;
    }
  })();
  if (!safeName) {
    return error404("Asset not found");
  }

  const rootedCandidate = nodePath.join(expectedDir, safeName);
  // Candidate locator may produce an alternate path; still require containment
  const resolvedCandidate =
    (await resolveCandidate(options.kind, safeName)) ?? rootedCandidate;

  // Both rooted and resolved candidates must stay in package root + subdir
  for (const cand of [rootedCandidate, resolvedCandidate]) {
    if (!(await isContainedInRoot(packageRoot, cand, realpathFn))) {
      return error404("Asset not found");
    }
    if (!(await isContainedInRoot(expectedDir, cand, realpathFn))) {
      return error404("Asset not found");
    }
  }

  // Open the rooted candidate (authority path under package root)
  let openPath = rootedCandidate;
  try {
    openPath = await realpathFn(rootedCandidate);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT") {
      return error404("Asset not found");
    }
    // EACCES / ELOOP / etc.
    return error404("Asset not found");
  }

  // Re-check after realpath (symlink final target)
  if (!(await isContainedInRoot(packageRoot, openPath, realpathFn))) {
    return error404("Asset not found");
  }
  if (!(await isContainedInRoot(expectedDir, openPath, realpathFn))) {
    return error404("Asset not found");
  }

  const file = Bun.file(openPath);
  if (!(await file.exists())) {
    return error404("Asset not found");
  }

  const headers = assetHeaders(options.kind, safeName, file.size);
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(file, { headers });
}

/** Extensions allowlist exported for tests (Sol N18). */
export const PDFJS_CMAP_EXTENSIONS = [...CMAP_EXTENSIONS];
export const PDFJS_STANDARD_FONT_EXTENSIONS = [...STANDARD_FONT_EXTENSIONS];
