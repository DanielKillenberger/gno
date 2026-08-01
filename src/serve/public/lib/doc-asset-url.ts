/**
 * Doc-asset URL helpers for the native PDF viewer (fn-112 task .5).
 *
 * Production `/api/doc-asset` resolves relative `path` against
 * `dirname(resolvedDoc.fullPath)` where the document is resolved by `uri`
 * (`recordSourcePath ?? relPath` under the collection root).
 *
 * Therefore the client must pass the **basename** of the API `relPath`
 * (which already incorporates recordSourcePath), not the full relative path —
 * joining a multi-segment relPath onto dirname would double the directories.
 *
 * Same-basename siblings in other directories remain distinct because `uri`
 * anchors the directory; only basename + uri is needed.
 */

/** Last path segment of a document relPath (POSIX or Windows separators). */
export function assetPathFromRelPath(relPath: string): string {
  const normalized = relPath.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized) {
    return relPath;
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

/**
 * Build encoded `/api/doc-asset?uri=…&path=…` for the indexed document file.
 * Same URL is used for PdfViewer assetUrl and downloadUrl.
 */
export function buildDocAssetUrl(uri: string, relPath: string): string {
  const path = assetPathFromRelPath(relPath);
  return `/api/doc-asset?uri=${encodeURIComponent(uri)}&path=${encodeURIComponent(path)}`;
}

/**
 * Spec predicate for extracted-text availability (DocView → PdfViewer).
 * Evaluated per render; never derived from mime/ext.
 */
export function isExtractedTextAvailable(doc: {
  contentAvailable: boolean;
  content: string | null | undefined;
}): boolean {
  return (
    doc.contentAvailable === true &&
    typeof doc.content === "string" &&
    doc.content.trim().length > 0
  );
}

export function isPdfDocument(source: {
  mime?: string | null;
  ext?: string | null;
}): boolean {
  const mime = (source.mime ?? "").toLowerCase();
  const ext = (source.ext ?? "").toLowerCase();
  return mime === "application/pdf" || ext === ".pdf";
}
