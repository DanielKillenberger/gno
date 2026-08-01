# fn-112 task .4 repair (Grok 4.5) — Sol NEEDS_WORK B1–B4

- **Owner:** Grok 4.5, sole implementation writer
- **Task:** `fn-112-native-pdfjs-document-renderer.4`
- **Branch:** `feat/native-pdf-renderer`
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Prior Sol review:** `.flow/reviews/fn-112-sol-impl-review-task-4.json` → **NEEDS_WORK** (B1–B4)
- **Prior Grok receipt:** `.flow/reviews/fn-112-grok-implementation-task-4.{md,json}` → **superseded_incomplete**
- **No Sol SHIP claimed**
- **Preserved:** plan SHIP; tasks .1–.3 Sol SHIP; no .5+/spec/architecture/commit/push/PR

## Dispositions

### B1 — real hook state semantics — **fixed**

- `showLoading = status === "loading"` only (no ready+!firstPageReady trap)
- `showEmpty = status === "ready" && numPages === 0` (matches real hook: `firstPageReady = numPages > 0`)
- `showProgressive = status === "ready" && numPages > 0`
- Integration test: actual `usePdfDocument` + lower-level `getDocument` seam resolves zero-page proxy → loading → exact empty, disabled nav/zoom, download actionable, no progressive/page nodes, no dual state cards

### B2 — controlled toolbar boundaries — **fixed**

- Digits-only finite values including `0` clamp to 1..N; empty/non-numeric revert
- Zoom-out disabled at `MIN_ZOOM`, zoom-in at `MAX_ZOOM` (facade constants, no pdfjs import)
- Viewer zoomIn/Out no-op when `stepZoom` cannot change zoom (any fit mode) → no gen/state/`preventDefault`
- Tests: 0→1 and >N→N Enter/blur; min/max button disable; keyboard at bounds no preventDefault/gen

### B3 — no Card chrome — **fixed**

- Flat `StatePanel` / loading treatment: centered eyebrow/body/actions, no rounded/border/bg-muted/shadow Card surface
- Error panels `role="alert"`; loading/empty `role="status"`
- DOM assertions reject card chrome classes and assert roles

### B4 — exact production contract + real composition — **fixed**

- `PdfViewerProps` exactly `{ assetUrl, downloadUrl, extractedTextAvailable, onFallback }`
- Internal `pdf-viewer-deps.tsx`: production defaults = real hooks; `PdfViewerTestDepsProvider` + `createDocumentHookWithDeps` / `createPagesHookWithDeps` for tests only (not props, not consumer barrel)
- Integration: real `usePdfPages` cancel/metrics path when viewer zoom bumps gen (deferred render → cancel → later start at higher gen)
- No `mock.module` pollution

### Responsive observation — **fixed** (in scope)

- Explicit mobile-only `basis-full lg:hidden` break between A+B and C+D; `flex-wrap` retained; source order preserved
- Non-vacuous tests: flex-wrap, break classes, child order, fit labels `hidden lg:inline` via dedicated testids, page input `hidden lg:inline-flex`, indicator always present
- Removed vacuous `querySelector || innerHTML`

## Changed files

| File | Change |
| --- | --- |
| `src/serve/public/components/pdf/PdfViewer.tsx` | B1/B3/B4 state + flat panels + exact props + internal deps |
| `src/serve/public/components/pdf/PdfToolbar.tsx` | B2 clamp/zoom bounds + structural mobile break |
| `src/serve/public/components/pdf/pdf-viewer-deps.tsx` | **new** internal test deps boundary |
| `test/serve/public/components/pdf/PdfViewer.dom.test.tsx` | rewritten: provider harness + integrations |
| `test/serve/public/components/pdf/PdfToolbar.dom.test.tsx` | B2 + responsive non-vacuous |
| `.flow/reviews/fn-112-grok-implementation-task-4.{md,json}` | marked superseded_incomplete |

## Commands / results

| Command | Exit | Result |
| --- | --- | --- |
| `bun test test/serve/public/components/pdf` | 0 | **39 pass** / 0 fail |
| hooks + lib/pdf + fn112 routes + security | 0 | **69 pass** / 0 fail |
| `bun run test:web` | 0 | **260 pass** / 0 fail (baseline 186) |
| `bun run lint:check` | 0 | 0 warnings/errors; format clean |
| `bunx tsc --noEmit` | 0 | clean |
| `git diff --check` | 0 | clean |
| Forbidden greps (pdfjs-dist in components, xl/2xl, hex, usePdf*Impl props) | 0 | no matches |
| `flowctl validate --spec fn-112-native-pdfjs-document-renderer` | 0 | valid |

## Remaining gate

Independent Sol **re-review** of task .4 repair. **No Sol SHIP claimed.**

---

## SUPERSEDED (B4-R2 evidence only)

This receipt is **superseded_incomplete_for_B4_R2** after Sol re-review
`.flow/reviews/fn-112-sol-impl-rereview-task-4.json` (sole blocker **B4-R2**).

B1–B3 and the non-timeout B4 source contract remain closed. Round-2 repair:
`.flow/reviews/fn-112-grok-implementation-task-4-repair-round2.{md,json}`.
