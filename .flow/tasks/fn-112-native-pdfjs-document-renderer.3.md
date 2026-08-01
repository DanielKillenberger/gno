---
satisfies: [R1, R6, R7, R10, R13]
---
# fn-112-native-pdfjs-document-renderer.3 Page rendering core: document/page hooks, PdfPageView, aligned text layer, virtualization

## Description
The rendering core and the spec's early proof point: document/page hooks, `PdfPageView` (canvas + aligned selectable text layer + safe link layer + rotation-aware placeholder), IntersectionObserver virtualization with strict cancellation and memory bounds, and the text-layer CSS contract.

**Size:** M
**Files:** `src/serve/public/hooks/use-pdf-document.ts` (new), `src/serve/public/hooks/use-pdf-pages.ts` (new), `src/serve/public/components/pdf/PdfPageView.tsx` (new), `src/serve/public/globals.css` (text-layer vars/rules), `test/serve/public/components/pdf/PdfPageView.dom.test.tsx` (new), `test/serve/public/hooks/use-pdf-document.dom.test.tsx` (new)

### Approach
- `use-pdf-document`: takes the asset URL; creates the loading task inside the effect via the `lib/pdf.ts` wrapper; exposes `{status: "loading"|"ready"|"error", doc, numPages, firstPageReady, error, retry}` with error discrimination through the facade's `classifyPdfError` (`"corrupt"|"password"|"network"|"bootstrap"`). **React 19 StrictMode invariant (precise — supersedes any "no duplicate load" phrasing):** dev StrictMode intentionally runs mount → cleanup → mount, so **two `getDocument` calls are expected and permitted**. What must hold is: (a) the first effect's loading task has `destroy()` called by its own cleanup, promptly, before the second load settles into state; (b) once a cleanup has run, at most one *undestroyed* loading task exists at any time — never two concurrently surviving tasks; (c) no state write ever lands from a destroyed or stale task — guard on `loadingTask.destroyed` **and** a monotonic effect-generation token captured at effect entry and compared before every `setState`; (d) the same generation token covers URL-change and retry races: when the URL changes or `retry()` fires while a load is in flight, a late/out-of-order resolution (or rejection) of the superseded promise must not overwrite the newer load's state, in either resolution order. Lifecycle/teardown conventions: mirror `hooks/use-doc-events.ts`.
- `use-pdf-pages`: IntersectionObserver window (visible ± overscan, live canvas ceiling ≤ 10) over page slots; per-page render scheduling. Cancellation order is load-bearing **when a render is actually in flight**: `RenderTask.cancel()` → await settle (swallow cancellation via the facade's `isRenderingCancelled`, never surface it) → `page.cleanup()` → zero `canvas.width/height` on eviction. Never call `page.cleanup()` with a render in flight (pdfjs docs are explicit). A superseding zoom/fit/scroll change that arrives **after** the previous render already settled must simply issue the new render — it must not synthesize a `renderCancel` for an already-terminal task, and no acceptance item anywhere requires one (spec P-4a vs P-4b).
- **Instrumentation (spec P-3…P-6, must survive React unmount — therefore NOT component state):** the hooks record every lifecycle event through the `lib/pdf.ts` facade helpers into the module-level `__gnoPdfMetrics` channel owned by task .2 (attached once to `globalThis`). Required events: `renderStart`, `renderCancel`, `renderSettle(completed|cancelled|failed)`, `pageCleanup`, `documentDestroy` — each emitted with the **full correlation schema** from the spec's "Metrics channel contract" (`seq`, `t`, `docId`, `pageNumber`, `taskId`, `genId`, `kind`, `outcome`, `scale`, `canvasWidth`, `canvasHeight`). The hooks are responsible for supplying correct correlation values: one `docId` per loaded document instance, the page's number, one `taskId` per `RenderTask`, and the `genId` in force when the render was issued (bumped by the viewer on every zoom/fit/scale commit; a task's cancel and settle repeat the `genId` its start carried), plus the logical scale and the post-cap backing-store dimensions actually used. Every `renderStart` must reach **exactly one** terminal `renderSettle` with the same `taskId` (no orphans, no doubles) — this, together with the correlation fields, is what makes P-3's numeric bound (≤ 60 starts over the spec's 200-page scroll procedure), P-4b's cancel → cancelled-settle → replacement-start ordering, and P-6's post-navigation silence assertable from the browser after the component tree is gone. Records are structured but **content-free** (never a URL, path, URI, filename, title, or document text) and carry no production API surface claim (documented in `docs/WEB-UI.md` by task .7 as an unstable diagnostic surface).
- `PdfPageView`: placeholder box sized from `getViewport({scale})` (viewport is rotation-aware — use viewport dims, never raw page dims); canvas rendered at the capped effective scale from `lib/pdf.ts`; the `TextLayer` class **imported from `../lib/pdf` (the facade re-export), never from `pdfjs-dist`** — v5 shape: constructor `{textContentSource, container, viewport}`, `.render()`, `.update()` on zoom, `.cancel()` — overlaid on the canvas; link layer from `page.getAnnotations()` rendering only sanitizer-approved external links (`target="_blank" rel="noopener noreferrer"`) and internal GoTo destinations as in-viewer page jumps (resolve via `doc.getDestination`/`getPageIndex`); other schemes inert text. Every pdfjs runtime value and type used here (`TextLayer`, `PDFPageProxy`, `RenderTask`, `PageViewport`, annotation types, classifiers) comes from the facade; if something is missing, extend `lib/pdf.ts` rather than importing `pdfjs-dist` here.
- Text-layer CSS contract (globals.css): the page wrapper must set `--scale-factor: <viewport.scale>` AND define `--total-scale-factor: calc(var(--scale-factor) * var(--user-unit, 1))` plus `--scale-round-x: 1px; --scale-round-y: 1px` — pdfjs v5 `TextLayer.setLayerDimensions` sizes from `--total-scale-factor` and it is NOT auto-derived; missing it collapses the layer / drifts selection at non-100% zoom. Style the layer per pdf.js `web/text_layer_builder.css` essentials (transparent text, selection background) using Scholarly Dusk tokens for selection color.
- DOM tests run under happy-dom with `mock.module` of `../lib/pdf` (see `test/serve/public/pages/DocView.dom.test.tsx:1-46` mocking pattern) — fake doc/page objects with **manually settleable deferred promises** so resolution order is controlled by the test. Assert: StrictMode invariant (a)-(d) above (count `getDocument` calls, assert first task `destroy()`ed, assert never two undestroyed tasks, assert no state write after destroy); URL-change race with the OLD promise resolving AFTER the new one; retry race with the same out-of-order shape; eviction ordering; placeholder aspect (incl. a rotated 90° viewport); sanitizer wiring; `classifyPdfError` discrimination for all four reasons; and that `__gnoPdfMetrics` records start/cancel/settle/cleanup/destroy with no orphaned starts. Real-pdfjs rendering correctness is task .6's browser evidence, not happy-dom's job.

### Investigation targets
**Required:**
- `src/serve/public/lib/pdf.ts` — bootstrap/wrapper from task .2 (build on it, don't import pdfjs-dist directly)
- `src/serve/public/hooks/use-doc-events.ts` — hook lifecycle/cleanup conventions
- `test/serve/public/pages/DocView.dom.test.tsx:1-60` — mock.module + renderWithUser pattern
- `src/serve/public/globals.css` — token/utility conventions before adding text-layer rules

**Optional:**
- wojtekmaj/react-pdf `Document.tsx` / `Page/Canvas.tsx` (GitHub) — loadingTask + cancel/cleanup reference patterns (pattern source only, not a dependency)

### Design context
- Page surface: paper-white canvas on the recessed well; hairline `border-border/40` page edge + soft paper shadow; NO dark-mode inversion of canvas content.
- Placeholders: correct aspect ratio, subtle pulse, `bg-muted/20` — no layout jump when the canvas mounts.
- Selection color: teal-tinted via existing `--primary` token, not browser default blue, if feasible with `::selection` on the text layer.
- Full system: `docs/adr/001-scholarly-dusk-design-system.md` (read before UI work).

### Key context
- This task is the early proof point: if worker bootstrap or text-layer alignment cannot work under Bun's HTML-import pipeline, stop and re-evaluate (workerPort with explicit module Worker as fallback) before tasks .4+.
- All budgets P-2…P-6 are implemented here (assertable via the instrumentation counter + bounded canvas count); they are verified with browser evidence in task .6.

### Acceptance
- [ ] `use-pdf-document` DOM tests encode the precise StrictMode invariant: two `getDocument` calls under StrictMode are ACCEPTED, the first task is `destroy()`ed by its own cleanup, at most one undestroyed task survives, and no state write lands from a destroyed/stale task
- [ ] URL-change and retry race tests with out-of-order promise resolution (superseded promise settles LAST) prove the newer load's state is never overwritten; destroy on unmount and on URL change asserted
- [ ] `classifyPdfError` discrimination asserted for corrupt / password / network / bootstrap
- [ ] `use-pdf-pages` DOM tests: live canvas count ≤ ceiling (10) under a simulated 200-slot document; eviction runs cancel → await settle → `page.cleanup()` → zeroed canvas dims; cancellation swallowed via `isRenderingCancelled` and never surfaced as an error
- [ ] `__gnoPdfMetrics` (module-level, `globalThis`-attached, owned by `lib/pdf.ts`) records `renderStart`/`renderCancel`/`renderSettle`/`pageCleanup`/`documentDestroy`; events recorded after component unmount remain readable (test asserts the channel survives unmount)
- [ ] **Correlation** unit-tested from the hooks: each event carries the correct `docId` (one per loaded instance, distinct across two loads of the same file), `pageNumber`, `taskId` (unique channel-wide), `genId` (monotonic per `docId`, bumped per zoom/fit commit, repeated identically on a task's cancel and settle), `scale`, and post-cap `canvasWidth`/`canvasHeight`; no record contains a URL, path, filename, or document text
- [ ] **Exactly one terminal settle per start, no orphans**: across a simulated eviction + zoom-churn sequence every `renderStart` `taskId` has exactly one `renderSettle` (never zero, never two), asserted from a `snapshot()` with `dropped === 0`
- [ ] **Cancellation/replacement ordering** unit-tested on the event stream: for a render cancelled in flight, `renderCancel` → `renderSettle(outcome: "cancelled")` → the replacement generation's first `renderStart` in strictly increasing `seq`, with the superseded generation never recording `renderSettle(outcome: "completed")` (the happy-dom analogue of P-4b)
- [ ] Retention behavior exercised through the hooks: a churn sequence exceeding the default capacity increments `dropped` rather than growing memory, and a `reset({capacity})` before a measured window yields `dropped === 0` for that window
- [ ] `PdfPageView` DOM tests: rotation-aware placeholder aspect; external `https:` link rendered with `target="_blank" rel="noopener noreferrer"`; `javascript:` annotation inert; internal destination triggers page-jump callback
- [ ] globals.css defines the `--scale-factor`/`--total-scale-factor`/`--scale-round-*` contract on the page wrapper and text-layer styles using semantic tokens only (no raw hex)
- [ ] `TextLayer` and every other pdfjs runtime/type symbol is imported from `../lib/pdf`; `rg "from ['\"]pdfjs-dist" src/` matches `src/serve/public/lib/pdf.ts` and nothing else (greppable assertion in the test suite)
- [ ] `bun test test/serve/public/components/pdf test/serve/public/hooks` green; `bun run test:web`, lint, typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-landing-record.md` (task .2 step 0)

## Acceptance
- [ ] StrictMode invariant as specified (two loads permitted, first promptly destroyed, no concurrent surviving task, no stale write) plus out-of-order URL-change and retry race tests
- [ ] Virtualization bounds live canvases, cancels before cleanup, zeroes evicted canvas dims, swallows cancellation via the facade
- [ ] `__gnoPdfMetrics` records starts/cancels/settles/cleanup/destroy with full correlation fields (docId/page/taskId/genId/scale/canvas dims), survives unmount, exactly one terminal settle per start, cancel→cancelled-settle→replacement-start ordering, bounded retention with `dropped`/`reset` proven, and no content or path leakage
- [ ] PdfPageView: rotation-aware placeholders, aligned TextLayer (facade import), sanitized external links, internal page-jump destinations
- [ ] --scale-factor + --total-scale-factor CSS contract present; Scholarly Dusk tokens only
- [ ] pdfjs-dist imported only in lib/pdf.ts (asserted); DOM suites + test:web + lint + typecheck no new failures vs the durable baseline receipt `.flow/reviews/fn-112-landing-record.md`


## Done summary
Fixed sole remaining Sol blocker I3-03 with non-vacuous deferred getDestination and getPageIndex tests after real OLD internal-link clicks and same-component identity replacement.

**Remaining gate: independent Sol re-review round 5.** No Sol SHIP claimed.
## Evidence
- Commits:
- Tests: bun test test/serve/public/components/pdf test/serve/public/hooks → 24 pass, bun run test:web → 231 pass, task .1/.2 regressions → 67 pass, bun run lint:check → 0, bunx tsc --noEmit → clean, git diff --check → clean
- PRs: