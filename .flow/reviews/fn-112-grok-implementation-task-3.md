# fn-112 task .3 implementation (Grok 4.5)

- **Task:** `fn-112-native-pdfjs-document-renderer.3`
- **Owner:** Grok 4.5 (sole writer)
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Branch:** `feat/native-pdf-renderer`
- **Preconditions:** task .1 Sol SHIP (round4), task .2 Sol SHIP (round3); partial files preserved/completed
- **Remaining gate:** **independent Sol per-task implementation review**
- **No Sol SHIP claimed**

## Acceptance matrix

| Area | Result |
| --- | --- |
| A. `use-pdf-document` StrictMode + races + classify + destroy/docId | **pass** |
| B. `use-pdf-pages` lazy 200-page, ceiling≤10, cancel order, metrics | **pass** |
| C. `PdfPageView` placeholder, TextLayer facade, safe links | **pass** |
| D. CSS scale contract + Scholarly Dusk tokens (no raw hex) | **pass** |
| E. Focused suite + test:web + .1/.2 regression + lint/tsc | **pass** |

## Implementation summary

### `use-pdf-document`
- Monotonic effect generation + `loadingTask.destroyed` gates on every state write
- StrictMode: two `getDocument` calls permitted; first `destroy()`ed by own cleanup
- URL-change / retry: superseded promise settling last cannot overwrite newer state
- `classifyPdfError` → corrupt | password | network | bootstrap
- Opaque per-load `gnoDocId`; `documentDestroy` on cleanup
- Optional test deps (avoids `mock.module` pollution of sibling suites)

### `use-pdf-pages`
- Slot geometry from **page 1 only** — never eagerly `getPage(1..N)` for 200-page docs
- IntersectionObserver window + overscan; `LIVE_CANVAS_CEILING = 10`
- In-flight eviction: `cancel` → await terminal settle (swallow `isRenderingCancelled`) → `page.cleanup` → zero canvas dims
- Already-terminal prior render: replacement **without** synthetic cancel
- Metrics: start/cancel/settle/cleanup with full correlation; one settle per start; retention `dropped` + `reset` window

### `PdfPageView`
- Rotation-aware placeholder via viewport width/height props
- `TextLayer` + types only via facade (injectable in tests)
- External https: `target=_blank` `rel=noopener noreferrer`; javascript inert; internal GoTo → page jump

### CSS
- `--scale-factor`, `--total-scale-factor: calc(...)`, `--scale-round-x/y`
- Paper surface as HSL semantic token (no raw `#hex`)

## Commands (verified)

```
bun test test/serve/public/components/pdf test/serve/public/hooks  → 20 pass
bun run test:web                                                   → 227 pass (baseline 186; no new failures)
task .1/.2 focused regressions                                     → 67 pass
bun run lint:check / bunx tsc --noEmit / git diff --check          → 0
rg pdfjs-dist in src/                                              → only lib/pdf.ts
flowctl validate                                                   → valid:true
```
