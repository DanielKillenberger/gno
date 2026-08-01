/**
 * DocView-only re-export of PdfViewer.
 *
 * Kept as a separate module so DOM tests can mock.module this path without
 * sticky-mock pollution of the real components/pdf/PdfViewer suite (fn-112.5).
 */
export { PdfViewer as default } from "../components/pdf/PdfViewer";
