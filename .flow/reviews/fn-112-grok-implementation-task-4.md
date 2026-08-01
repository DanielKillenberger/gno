# fn-112 task .4 implementation (Grok 4.5)

- **Owner:** Grok 4.5 (authenticated grok.com), sole implementation writer
- **Task:** `fn-112-native-pdfjs-document-renderer.4`
- **Branch:** `feat/native-pdf-renderer`
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **No Sol SHIP claimed** for this task — implementation receipt only
- **Preserved:** tasks .1–.3 Sol SHIP (untouched product contracts)

## Frontend-design gate

| Artifact | Path |
| --- | --- |
| Design brief receipt | `.flow/reviews/fn-112-opus-plan-repair-task-4-design.md` |
| Design brief JSON | `.flow/reviews/fn-112-opus-plan-repair-task-4-design.json` |
| Noncanonical execution brief | `/home/claw/.claude/plans/use-frontend-design-frontend-design-now-cached-widget.md` |
| Plan SHIP (Sol progressive-final) | `.flow/reviews/fn-112-sol-plan-rereview-task4-progressive-final.json` |

Canonical current `.flow` spec/tasks supersede the noncanonical brief where repaired (copy, fallback predicate, view-toggle ownership, progressive hook). No re-invocation of `frontend-design`; gate recorded satisfied 2026-07-31.

## Deliverables

| File | Role |
| --- | --- |
| `src/serve/public/components/pdf/PdfToolbar.tsx` | Pure controlled instrument rail (Button/Tooltip/Input + lucide); no pdfjs; no Pages/Text toggle |
| `src/serve/public/components/pdf/PdfViewer.tsx` | Shell: usePdfDocument/usePdfPages/PdfPageView; page/zoom/fit/gen; states; keyboard; fallback once-guard |
| `test/serve/public/components/pdf/PdfToolbar.dom.test.tsx` | Toolbar DOM acceptance |
| `test/serve/public/components/pdf/PdfViewer.dom.test.tsx` | Viewer DOM acceptance (injectable hook seams — no `mock.module` pollution) |
| `src/serve/public/globals.css` | Semantic isolation + page-column scrollbar-gutter only (viewer shell); page chrome retained from .3 |

## Acceptance coverage (non-vacuous)

- **Toolbar:** prev/next boundaries; Enter/blur commit; clamp 1..N; invalid revert; Escape revert; aria-live n/N; zoom/reset; fit segments; custom → both `aria-pressed=false`; download anchor; disabled zero-page; responsive `hidden`/`lg:inline*` classes; no view toggle
- **Keyboard:** PageDown/ArrowRight next, PageUp/ArrowLeft prev, +/= zoom in, - zoom out, 0 reset→custom 100%; input focus excluded; ArrowUp/Down/Home/End/Space unhandled; preventDefault only when state changes; boundary/already-reset no preventDefault
- **States:** loading/empty/corrupt/password/network/bootstrap exact copy + hooks; progressive = page column + `data-rendered` true/false simultaneous, zero `pdf-state-*`; password no retry; others Try again + Download original
- **Fallback:** extractedTextAvailable=true → onFallback once per failed load (all four reasons), no card; false → never calls, keeps card; re-fire after new docId / retry re-arm
- **Gen path:** zoom/fit bumps `genId` into usePdfPages (task .3 cancel path)
- **a11y / motion:** viewer `tabIndex=0` + aria-label; icon aria-labels; reduced-motion → `scrollIntoView({ behavior: "auto" })`
- **Forbidden:** no iframe/object/embed; no raw hex in components; no xl/2xl; no pdfjs imports in toolbar/viewer; no view toggle; no Card primitive import

## Commands / results

Baseline comparison source: `.flow/reviews/fn-112-baseline-receipt.json` (base_sha `bb994b580356a41a31093fea85b06993c1a18e4c`; test:web baseline **186 pass**).

| Command | Exit | Result |
| --- | --- | --- |
| `bun test test/serve/public/components/pdf` | 0 | **35 pass** / 0 fail |
| `bun test` hooks + lib/pdf + fn112 routes + security | 0 | **69 pass** / 0 fail (.1–.3 regression surface) |
| `bun run test:web` | 0 | **256 pass** / 0 fail (baseline 186; delta = fn-112 DOM suites, no new failures) |
| `bun run lint:check` | 0 | 0 errors; format clean |
| `bunx tsc --noEmit` | 0 | clean |
| `git diff --check` | 0 | clean |
| Forbidden greps (iframe/embed, hex, xl/2xl, pdfjs-dist in components, view-toggle/progressive card) | 0 | clean (only comments / negative assertions) |
| `.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer` | 0 | valid |

## Explicit non-claims

- **No Sol implementation SHIP** for task .4
- **No commit / push / PR**
- **No task .5+** (DocView owns Pages/Text toggle)
- **No architecture / spec edits**

## Remaining gate

Independent Sol implementation review of task .4 when host schedules it.

---

## SUPERSEDED INCOMPLETE

This receipt is **superseded_incomplete** after Sol impl-review **NEEDS_WORK**
(`.flow/reviews/fn-112-sol-impl-review-task-4.json`, blockers B1–B4).

Repair receipt: `.flow/reviews/fn-112-grok-implementation-task-4-repair.{md,json}`.
