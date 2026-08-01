/**
 * Internal dependency boundary for PdfViewer.
 *
 * Production always uses the real usePdfDocument / usePdfPages hooks.
 * Tests may wrap the viewer in PdfViewerTestDepsProvider to substitute
 * lower-level seams or controlled hook adapters — never via PdfViewer props.
 *
 * Not a product barrel export. Import only from tests or PdfViewer itself.
 */

import { createContext, useContext, type ReactNode } from "react";

import {
  usePdfDocument as defaultUsePdfDocument,
  type UsePdfDocumentDeps,
  type UsePdfDocumentResult,
} from "../../hooks/use-pdf-document";
import {
  usePdfPages as defaultUsePdfPages,
  type UsePdfPagesOptions,
  type UsePdfPagesResult,
} from "../../hooks/use-pdf-pages";

export type PdfViewerDocumentHook = (
  url: string | null
) => UsePdfDocumentResult;

export type PdfViewerPagesHook = (
  options: UsePdfPagesOptions
) => UsePdfPagesResult;

export type PdfViewerInternalDeps = {
  usePdfDocument: PdfViewerDocumentHook;
  usePdfPages: PdfViewerPagesHook;
};

const productionDeps: PdfViewerInternalDeps = {
  usePdfDocument: (url) => defaultUsePdfDocument(url),
  usePdfPages: (options) => defaultUsePdfPages(options),
};

const PdfViewerDepsContext =
  createContext<PdfViewerInternalDeps>(productionDeps);

/** Used only by PdfViewer — resolves production defaults or test overrides. */
export function usePdfViewerInternalDeps(): PdfViewerInternalDeps {
  return useContext(PdfViewerDepsContext);
}

/**
 * Test-only harness. Production call sites must not use this.
 * Keeps PdfViewerProps to the exact four-prop contract.
 */
export function PdfViewerTestDepsProvider({
  deps,
  children,
}: {
  deps: Partial<PdfViewerInternalDeps>;
  children: ReactNode;
}) {
  const value: PdfViewerInternalDeps = {
    usePdfDocument: deps.usePdfDocument ?? productionDeps.usePdfDocument,
    usePdfPages: deps.usePdfPages ?? productionDeps.usePdfPages,
  };
  return (
    <PdfViewerDepsContext.Provider value={value}>
      {children}
    </PdfViewerDepsContext.Provider>
  );
}

/** Real document hook with lower-level facade deps (getDocument, metrics, …). */
export function createDocumentHookWithDeps(
  documentDeps: UsePdfDocumentDeps
): PdfViewerDocumentHook {
  return (url: string | null) => defaultUsePdfDocument(url, documentDeps);
}

/** Real pages hook with optional lower-level IO/metrics seams. */
export function createPagesHookWithDeps(
  pagesDeps: Partial<
    Pick<
      UsePdfPagesOptions,
      | "getPdfMetrics"
      | "computeEffectiveScale"
      | "isRenderingCancelled"
      | "IntersectionObserverImpl"
      | "devicePixelRatio"
    >
  > = {}
): PdfViewerPagesHook {
  return (options: UsePdfPagesOptions) =>
    defaultUsePdfPages({ ...options, ...pagesDeps });
}
