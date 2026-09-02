/**
 * PDF transport tier constants (fn-136 R1).
 *
 * Kept free of any pdfjs-dist import so tooling that runs under plain Bun
 * (for example the Playwright smoke in scripts/pdf-viewer-smoke.ts) can read
 * the product bounds without evaluating the browser-only pdf.js build.
 * `./pdf` re-exports both names, so app code keeps importing from the facade.
 */

/** Files whose HEAD Content-Length is under this load in one GET. */
export const PDF_WHOLE_FILE_MAX_BYTES = 8 * 1024 * 1024;
/** Range chunk size for files at or above the whole-file bound. */
export const PDF_RANGE_CHUNK_BYTES = 1024 * 1024;
