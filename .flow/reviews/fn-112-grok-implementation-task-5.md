# fn-112 task .5 implementation (Grok 4.5)

- **Owner:** Grok 4.5 (authenticated grok.com), sole writer
- **Task:** `fn-112-native-pdfjs-document-renderer.5`
- **Branch:** `feat/native-pdf-renderer`
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **No Sol SHIP claimed**
- **Preserved:** tasks .1–.4 Sol SHIP; PdfViewer exact four-prop contract; internal pdf-viewer-deps boundary

## Asset URL derivation (N5)

**Decision: basename of API `relPath` as relative `path`.**

Evidence from production `handleDocAsset` (`src/serve/routes/api.ts`):

```ts
const candidate = nodePath.resolve(
  nodePath.dirname(resolvedDoc.fullPath),
  assetPath
);
```

Document identity is resolved by `uri` → store document → `resolveAbsoluteDocPath` using `recordSourcePath ?? relPath`. The client path is joined to **dirname of that absolute file**.

| Case | Why basename is correct |
| --- | --- |
| Nested `relPath` (`nested/dir/report.pdf`) | `dirname(full)+basename` → same full path; full relPath would double-nest |
| `recordSourcePath`-backed | API already returns `relPath = recordSourcePath ?? relPath`; basename of that path segment is the file name in its directory |
| Container-backed | Same as above |
| Same-basename sibling | URI anchors directory; `path=report.pdf` with uri dir1 ≠ uri dir2 |

Pure proof: `test/serve/public/lib/doc-asset-url.test.ts` (dirname+basename, sibling inequality, double-nest failure of full relPath).

Helper: `src/serve/public/lib/doc-asset-url.ts` — `buildDocAssetUrl`, `assetPathFromRelPath`, `isExtractedTextAvailable`, `isPdfDocument`.

## Deliverables

| File | Role |
| --- | --- |
| `src/serve/public/lib/doc-asset-url.ts` | Pure URL/predicate/classification helpers |
| `src/serve/public/pages/doc-pdf-viewer.tsx` | DocView-only re-export for lazy + mock isolation |
| `src/serve/public/pages/DocView.tsx` | isPdf branch, Pages/Text, fallback notices, lazy viewer |
| `test/serve/public/pages/DocView.dom.test.tsx` | Extended PDF integration + preserved markdown test |
| `test/serve/public/lib/doc-asset-url.test.ts` | N5 + predicate table |

## Acceptance coverage

1. **Classification:** case-insensitive mime `application/pdf` OR ext `.pdf`
2. **Lazy PdfViewer:** `lazy(() => import("./doc-pdf-viewer"))` + Suspense; non-PDF never loads pdfjs
3. **Pages/Text:** DocView-owned floating pill; markdown Source/Rendered unchanged; `view=source` / lineStart → Text via existing effect
4. **Predicate:** exact `isExtractedTextAvailable` per render; passed to PdfViewer only
5. **Fallback:** `pdfFallbackReason`; onFallback sets reason + Text; four exact notices + download only; clear on Pages; mutual exclusion with pdf-state-*
6. **Empty text:** manual Text → “No extracted text for this document.”; zero pdf-fallback-*; not-available distinct
7. **Asset URL:** basename + uri; sibling proof; nested/container/record shapes
8. **Download:** header + notice + empty sub-state; Open original when absPath
9. **Remount:** `key={doc.uri}` on PdfViewer

## Commands / results

Baseline: `.flow/reviews/fn-112-baseline-receipt.json` (test:web 186 pass).

| Command | Result |
| --- | --- |
| `bun test test/serve/public/pages/DocView.dom.test.tsx` | **14 pass** |
| `bun test test/serve/public/lib/doc-asset-url.test.ts` | **6 pass** |
| PDF components + DocView + asset-url | **59 pass** |
| hooks + pdf lib + routes + security | **69 pass** (with prior surface) |
| `bun run test:web` | **279 pass** / 0 fail (baseline 186) |
| `bun run lint:check` | clean |
| `bunx tsc --noEmit` | clean |
| `git diff --check` | clean |
| Forbidden greps (iframe/pdfjs in DocView, toolbar view-toggle) | clean |
| Flow validate | valid |

## Explicit non-claims

- No Sol SHIP for task .5
- No commit / push / PR
- No task .6+
- No architecture/spec edits beyond the thin DocView re-export isolation module

## Remaining gate

Independent Sol implementation review of task .5.

---

## SUPERSEDED INCOMPLETE

This receipt is **superseded_incomplete** after Sol impl-review **NEEDS_WORK**
(`.flow/reviews/fn-112-sol-impl-review-task-5.json`, blockers B5-01..B5-03).

Repair: `.flow/reviews/fn-112-grok-implementation-task-5-repair.{md,json}`.
