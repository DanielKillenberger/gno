---
satisfies: [R4, R5, R8, R9, R15]
---
# fn-112-native-pdfjs-document-renderer.4 PdfViewer shell with instrument-rail toolbar, designed states, and keyboard accessibility

## Description
The user-facing viewer: `PdfViewer` shell composing the hooks, the Scholarly Dusk instrument-rail `PdfToolbar`, all designed states (loading / progressive / empty / corrupt / password / network / bootstrap-failure), keyboard interaction, and responsive behavior.

**Size:** M
**Files:** `src/serve/public/components/pdf/PdfViewer.tsx` (new), `src/serve/public/components/pdf/PdfToolbar.tsx` (new), `test/serve/public/components/pdf/PdfViewer.dom.test.tsx` (new), `test/serve/public/components/pdf/PdfToolbar.dom.test.tsx` (new)

### Approach
- **Gate before starting (spec execution note, `src/serve/AGENTS.md` mandate): SATISFIED (2026-07-31).** The `frontend-design:frontend-design` skill was invoked successfully via the isolated explicit plugin invocation; its brief is recorded at `.flow/reviews/fn-112-opus-plan-repair-task-4-design.md`. No re-invocation and no `flowctl block` is required for this task. The design direction stays pinned by the spec (Scholarly Dusk / ADR-001) — the pass refined execution within it and did not reopen the palette or type system. The four gaps it surfaced are now resolved in the spec (canonical state copy, view-toggle ownership, arrow-key semantics, `FitMode: "custom"`); implementation follows the spec text, not the brief, wherever they could differ.
- `PdfViewer` props (shape, not code): `{assetUrl, downloadUrl, extractedTextAvailable, onFallback}` where `onFallback(reason: PdfFallbackReason)` and `PdfFallbackReason = "corrupt" | "password" | "network" | "bootstrap"` (the type is exported from `lib/pdf.ts` alongside `classifyPdfError`, so DocView and the viewer share one source of truth; `"bootstrap"` is the worker-startup/document-load-rejection case — auxiliary cMap/standard-font 404s do not necessarily reject the load and must not be wired to a fallback here). Owns page/zoom/fit state; wires `use-pdf-document` + `use-pdf-pages`; renders the toolbar, the scrollable page column on the recessed well, and one designed state per spec's failure-mode table, using the exact strings, eyebrows, test hooks, and action sets in the spec's **"Canonical state copy"** table (no invented copy; the progressive state is aspect-correct placeholders with no copy and no card). Fallback rule (`extractedTextAvailable` is the exact predicate defined in the spec — `doc.contentAvailable === true && typeof doc.content === "string" && doc.content.trim().length > 0`, computed by DocView and passed in as a boolean prop; the viewer never re-derives it): when `extractedTextAvailable` is true, call `onFallback(reason)` exactly once per failed load — DocView owns the switch to Text and the persistent notice (task .5); when it is false, do NOT call `onFallback` and instead keep the viewer's own error card actionable (retry + "Download original"). The reason passed is the `classifyPdfError` verdict, unmodified.
- `PdfToolbar` is pure/controlled (no pdfjs imports), composed from `components/ui/*` (Button, Tooltip, Input); groups per the spec's toolbar contents; page-number input commits on Enter/blur only, ignores non-numeric, clamps 1..numPages; zoom readout button resets to 100%; fit-mode segmented pill (Fit width / Fit page). **No `Pages`/`Text` view toggle in the rail** — DocView owns that control via the existing `showRawView` floating pill (`DocView.tsx:1583-1607`, spec "View-toggle ownership", R19, task .5); a second toggle is a defect. **Fit segments vs. `FitMode`:** two segments over the three-member type — an explicit zoom commit (buttons or `+`/`-`/`0`) sets `fitMode: "custom"` and both segments report `aria-pressed="false"`.
- Keyboard: viewer container focusable (`tabIndex`, visible focus ring); PageUp/PageDown and **ArrowLeft/ArrowRight** page, `+`/`-`/`0` zoom when focus is inside the viewer and NOT in the page input; **ArrowUp/ArrowDown/Home/End/Space are never handled** and fall through to native scrolling of the page column (spec "Keyboard arrow semantics" is the authoritative map); all controls Tab-reachable; `aria-label` on icon-only buttons; page indicator wrapped in `aria-live="polite"`; respect `prefers-reduced-motion` (existing globals.css media query disables CSS animations; JS-driven scroll-into-view must additionally check `matchMedia("(prefers-reduced-motion: reduce)")` and use `behavior: "auto"` when it matches, since CSS cannot disable programmatic smooth scrolling). **`preventDefault()` only when the viewer actually handles the key** (N4): if the shortcut is out of scope (focus in the page-number input, zero-page/empty document with disabled controls, already at the first/last page boundary where the viewer takes no action, or a vertical-arrow/scroll key), let the event through so native scrolling still works — otherwise keyboard users get double movement or a dead key. Assert both halves: handled key → `defaultPrevented === true` and viewer state changed; unhandled key → `defaultPrevented === false` and no state change.
- Responsive: at `< lg` the rail wraps (`flex-wrap`) to two rows, fit-mode labels collapse to icons, page input collapses to indicator-only. Do not use `xl+` breakpoints for structure (ADR-001 rule). The rail is the spec's signature element and the only place boldness is spent — no additional decorative chrome, no numbered markers, no second accent color.
- DOM tests with mocked `../lib/pdf` + mocked hooks where simpler: toolbar interactions (clamp, commit-on-Enter, zoom steps/reset, fit toggle), keyboard map incl. input-focus exclusion and the preventDefault-only-when-handled rule, each of the seven designed states renders its copy + actions, `onFallback(reason)` fired once with the right reason when `extractedTextAvailable` is true and NOT fired when it is false, `aria-*` assertions via testing-library roles.

### Investigation targets
**Required:**
- `src/serve/public/components/pdf/PdfPageView.tsx` + hooks from task .3 — the API being composed
- `docs/adr/001-scholarly-dusk-design-system.md` — toolbar/pill/focus/anti-pattern rules
- `src/serve/public/pages/DocView.tsx:1583-1607` — the floating-pill vocabulary the toolbar toggle mirrors
- `src/serve/public/components/ui/button.tsx`, `tooltip.tsx`, `input.tsx` — primitives to compose

**Optional:**
- `src/serve/public/components/ai-elements/loader.tsx` — loading spinner used across the app
- `test/serve/public/pages/Search.dom.test.tsx` — user-event interaction test patterns

### Design context
- Signature element: the instrument rail — sticky glass bar (`bg-background/85 backdrop-blur`, hairline `border-border/40` bottom), `font-mono` microtype, `tabular-nums` page indicator `12 / 240` with current page `text-primary`, zoom % as mono button.
- Rejections: Chrome-viewer grey chrome, Material raised buttons, white drop-shadow cards, thumbnails.
- States copy: use the spec's "Canonical state copy" table verbatim (eyebrow + body + actions + test hook per state). The two approved register strings are preserved byte-exact — `Preparing document…` on the loading state here, and `This PDF could not be rendered. View the extracted text or download the original.` as the corrupt-reason fallback notice in DocView (task .5), since the viewer's own card is only reachable when no extracted text exists. Action labels are fixed: `Try again`, `Download original`.
- Focus: `focus-visible:ring-primary/50`; every clickable gets `cursor-pointer`.
- Full system: ADR-001 (mandatory read).

### Key context
- Zoom/fit changes must route through the cancellation path from task .3 (spec P-4b — cancellation applies when a render is still in flight; a commit made after the previous render settled simply starts a new one and cancels nothing); the toolbar never talks to pdfjs directly.
- Empty/zero-page doc: toolbar renders disabled controls, not hidden ones — and disabled controls must not swallow keys (see the preventDefault rule).
- Every state in this task must be reachable deterministically in the browser for task .6's evidence: keep state selection driven by hook status + props, with stable `data-testid`/role hooks on each state card, so Playwright can drive loading / progressive / empty / corrupt / password / network / bootstrap without racing. **Progressive is explicitly exempt from the `pdf-state-*` card-hook requirement** (spec "Progressive state hook") — it has no card and no copy by design; its deterministic hooks are `data-testid="pdf-page-column"` plus per-page `data-rendered="false"` / `data-rendered="true"` nodes from task .3. Do not add a progressive state card, eyebrow, copy, or `pdf-state-progressive` id to satisfy the wording.

### Acceptance
- [ ] Toolbar: prev/next, Enter/blur-committed clamped page input, `n / N` tabular-nums indicator, zoom in/out + % reset button, fit-width/fit-page — all covered by DOM tests; no `Pages`/`Text` toggle rendered by `PdfToolbar` (asserted); `fitMode === "custom"` leaves both segments `aria-pressed="false"` (asserted)
- [ ] Keyboard: paging + zoom shortcuts scoped to viewer focus (excluded while typing in the page input); ArrowLeft/ArrowRight page while ArrowUp/ArrowDown are never handled (both asserted); handled keys call `preventDefault()`, unhandled/boundary/disabled/vertical-arrow cases do NOT (both asserted); all controls Tab-reachable with visible focus rings; `aria-label`s + `aria-live` indicator asserted
- [ ] All seven failure-mode states render the exact eyebrow/body/action set from the spec's "Canonical state copy" table (progressive = placeholders, no copy, no card hook — exempt per spec "Progressive state hook"), asserted string-exact in DOM tests; `onFallback(reason)` fires once with the correct reason when `extractedTextAvailable` is true, and does NOT fire when it is false (error card stays actionable with retry + Download original) — DOM tests for all four reasons
- [ ] Responsive: `< lg` rail wraps to two rows with icon-only fit modes (DOM assertion on classes/structure)
- [ ] Scholarly Dusk conformance: semantic tokens only, no raw hex, no new fonts or colors, `cursor-pointer` on clickables, no Card chrome inside the viewer well; `frontend-design` plugin invoked for the rail/state design (or the task blocked per the gate above)
- [ ] Each designed state carries a stable test hook for task .6 browser driving — six `pdf-state-*` card hooks, and progressive via `pdf-page-column` + `data-rendered="false"`/`"true"` page nodes (no progressive card, no `pdf-state-progressive`); a DOM test asserts progressive renders zero `[data-testid^="pdf-state-"]` nodes while both a rendered and an unrendered page node exist
- [ ] `bun test test/serve/public/components/pdf` green; `bun run test:web`, lint, typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (task .2 step 0)

## Acceptance
- [ ] Instrument-rail toolbar fully functional and DOM-tested (nav, clamped input, zoom, fit modes); no duplicate `Pages`/`Text` toggle; `custom` fit state renders neither segment pressed
- [ ] Keyboard a11y: scoped shortcuts (ArrowLeft/ArrowRight page, ArrowUp/ArrowDown native), preventDefault only when handled, Tab-reachable controls, focus rings, aria-labels, aria-live indicator
- [ ] All designed states (loading/progressive/empty/corrupt/password/network/bootstrap) render the spec's canonical copy string-exact with stable test hooks; `onFallback(reason)` contract tested in both directions
- [ ] Responsive <lg two-row rail; Scholarly Dusk tokens only; frontend-design plugin gate satisfied (recorded 2026-07-31, receipt `.flow/reviews/fn-112-opus-plan-repair-task-4-design.md`)
- [ ] DOM suites + test:web + lint + typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json`


## Done summary
# fn-112.4 repair round2 — B4-R2

**Root cause:** `ensureRendered` `useCallback` omitted `genId`; PdfPageView `onRender` effect never re-entered after gen cancel while active stayed true → no higher-gen replacement start (timeout under focused 5s).

**Production:** add `genId` to `ensureRendered` deps so identity changes on gen commit; preserves start < cancel < cancelled settle < higher-gen start.

**Test:** event-driven metric/task latches; explicit IO; finally settles tasks; no timeout paper-over. Isolated ~220ms ×3; suite 39 pass ×3.

Prior repair receipt superseded for B4-R2 only. **No Sol SHIP.**
## Evidence
- Commits:
- Tests: isolated integration ×3 → pass 220/213/216 ms (default 5s timeout), bun test test/serve/public/components/pdf ×3 → 39 pass each (~1.9–2.1s), use-pdf-pages.dom.test.tsx → 4 pass (I3-02 cancel path preserved), hooks+lib+fn112+security → 69 pass, bun run test:web → 260 pass, bun run lint:check → 0, bunx tsc --noEmit → clean, git diff --check → clean
- PRs: