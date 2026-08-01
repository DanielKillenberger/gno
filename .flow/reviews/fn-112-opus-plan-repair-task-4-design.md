# fn-112 — Opus plan repair: task .4 design gaps

**Kind:** targeted plan/spec clarification (no implementation)
**Spec:** `fn-112-native-pdfjs-document-renderer`
**Task in scope:** `.4` (PdfViewer shell, instrument-rail PdfToolbar, designed states, keyboard a11y)
**Model:** `claude-opus-5` · **Effort:** medium · **Session:** `4fc6c33e-828c-483a-b431-92956a1f64d2`
**Date:** 2026-07-31

## frontend-design gate

The `frontend-design:frontend-design` skill was **invoked successfully** in this session via the
isolated explicit plugin invocation (host session, not a subagent). The design gate mandated by
`src/serve/AGENTS.md:5-11` and the spec's "frontend-design plugin gate" execution note is therefore
**satisfied for task .4**; no `flowctl block` is required.

**Source design brief:** `/home/claw/.claude/plans/use-frontend-design-frontend-design-now-cached-widget.md`
(read-only brief produced by that pass; it is an input, not a canonical artifact — implementation
follows the `.flow` spec text wherever the two could differ).

That pass surfaced **four gaps in the already-approved plan**. This repair resolves all four and
nothing else: no architecture, scope, palette, or type-system change.

## Decisions applied

### 1. Canonical state copy (replaces a "verbatim" pointer at absent copy)

Task `.4` instructed implementers to take copy "verbatim from the spec's design-direction copy
register", but the register contained only two strings. The spec now carries a **"Canonical state
copy"** table fixing eyebrow + body + actions + test hook for every state:

| State | Eyebrow | Body | Actions |
| --- | --- | --- | --- |
| Loading | `LOADING` | `Preparing document…` | none |
| Progressive | — | **no copy** — aspect-correct placeholders only, no card | none |
| Empty / zero-page | `EMPTY DOCUMENT` | `This PDF has no pages.` | `Download original` |
| Corrupt | `CANNOT RENDER` | `This PDF could not be rendered. Download the original to read it.` | `Try again`, `Download original` |
| Password | `PASSWORD PROTECTED` | `This PDF is password protected. Download the original to open it in a PDF reader.` | `Download original` |
| Network | `COULD NOT LOAD` | `The document could not be loaded from this session. Try again, or download the original.` | `Try again`, `Download original` |
| Bootstrap | `VIEWER UNAVAILABLE` | `The PDF viewer could not start in this window. Download the original to read it.` | `Try again`, `Download original` |

Both pre-existing register strings are **preserved byte-exact**:

- `Preparing document…` (U+2026) stays the loading copy in the viewer.
- `This PDF could not be rendered. View the extracted text or download the original.` is anchored as
  the canonical **corrupt-reason fallback notice** in DocView (task `.5`). Rationale recorded in the
  spec: the viewer's own corrupt card is only reachable when `extractedTextAvailable === false`, so a
  card must not tell the reader to view extracted text that does not exist. The card therefore carries
  the no-extracted-text variant; neither string is reworded.

Progressive is explicitly defined as **placeholder-only, no copy, no card** — that was the prior
intent and is now stated rather than implied.

### 2. `Pages` / `Text` ownership — DocView, single owner

The spec's design-direction sentence listed a view toggle among toolbar contents while R19 and task
`.5` assign it to DocView's existing `showRawView` floating pill (`DocView.tsx:1583-1607`). Resolved
in favour of DocView (the later, more specific contract): the toolbar-contents sentence no longer
lists it, a **"View-toggle ownership"** subsection makes DocView the sole owner, the `PdfToolbar`
component-table row states it renders none, and a duplicate toggle in the rail is declared a defect.

### 3. Arrow keys

`ArrowLeft`/`ArrowRight` page (with `PageUp`/`PageDown`); `ArrowUp`/`ArrowDown`/`Home`/`End`/`Space`
are **never handled and never `preventDefault()`ed**, so native scrolling of the page column survives.
Recorded as a **"Keyboard arrow semantics"** table that is now the authoritative N4 map (handled →
`preventDefault`; input focus, boundaries, disabled document, vertical arrows → not handled). Also
added: `prefers-reduced-motion` must be checked in JS for programmatic scroll-into-view, since the
CSS media query cannot disable `behavior: "smooth"`.

### 4. `FitMode: "custom"`

`use-pdf-pages.ts` exposes `"width" | "page" | "custom"` while the rail shows two segments. Fixed:
two visible segments; an explicit zoom commit (buttons or `+`/`-`/`0`) sets `"custom"` and leaves
**both** segments `aria-pressed="false"`. Stated in the design direction, the frontend contract, the
component table, and task `.4` acceptance.

## Changed paths

| Path | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | Design direction: toolbar contents (toggle removed), fit-mode bullet, copy-register rewrite; new subsections "Canonical state copy", "View-toggle ownership", "Keyboard arrow semantics"; `PdfToolbar` component-table row; failure-mode table rows (loading, progressive, corrupt, password, network, bootstrap, zero-page); frontend-contract keyboard + fit-mode bullets; R4/R5/R8 tightened; execution-note gate status |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.json` | `plan_review_status: "ship" → "unknown"`, `plan_reviewed_at: "2026-07-31T15:39:17.828662Z" → null`, `ready: true → false`, `updated_at` bumped. All other fields untouched (`status: "open"`, `next_task`, `plan_review_rounds: 1`, `impl_review_rounds`, tracker block, `completion_review_status`) |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.4.md` | Gate bullet → SATISFIED with receipt pointer; state-copy references → canonical table; toolbar bullet (no view toggle, custom fit); keyboard bullet (arrows, reduced-motion JS guard); design-context copy bullet; both acceptance blocks |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.5.md` | Fallback bullet: corrupt notice anchored to the preserved register string; DocView restated as sole owner of the `Pages`/`Text` pill |
| `.flow/reviews/fn-112-opus-plan-repair-task-4-design.{md,json}` | This receipt |

**No task JSON was modified.** Task `.4` stays `status: "todo"`, unclaimed. Completed task acceptance
state, done summaries, evidence, and all prior receipts — including the durable baseline receipt
`.flow/reviews/fn-112-baseline-receipt.json` — are untouched.

## Sources

- `/home/claw/.claude/plans/use-frontend-design-frontend-design-now-cached-widget.md` (design brief)
- `.flow/specs/fn-112-native-pdfjs-document-renderer.md` (approved spec, pre-repair)
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.4.md`, `.5.md`
- `docs/adr/001-scholarly-dusk-design-system.md` (§Color, §Typography, §Layout, §Floating Controls, §Accessibility, §Anti-Patterns)
- `src/serve/AGENTS.md:1-12`, `src/serve/CLAUDE.md`, root `AGENTS.md` / `CLAUDE.md`
- `src/serve/public/hooks/use-pdf-document.ts:12-23`, `use-pdf-pages.ts:12-72`, `lib/pdf.ts:82-92,272-331`, `components/pdf/PdfPageView.tsx:12-26`, `pages/DocView.tsx:1580-1607`
- `components/ui/button.tsx`, `input.tsx`, `tooltip.tsx`; `globals.css:341,444,455-560`

## Impact on prior approvals

The previously recorded plan review verdict **SHIP** (`plan_review_rounds: 1`,
`.flow/reviews/fn-112-sol-final-plan-review.json`) was issued against the pre-repair plan text and is
**invalidated by this change**. The historical review artifacts are preserved unedited; only the
spec's live metadata was reset. `plan_review_status: "unknown"` and `ready: false` are the supported
values for "changed since approval, awaiting re-review" (`flowctl spec set-plan-review-status`
accepts `ship | needs_work | unknown`; readiness is a boolean spec-level flag). No unsupported status
value was invented.

## Validation

`flowctl` execution and `git diff` were **permission-denied in this session** (Bash approval was not
granted for `.flow/bin/flowctl …`). Consequently:

- Metadata was edited directly in the documented sidecar shape rather than via
  `flowctl spec set-plan-review-status --status unknown` + `flowctl spec unready`. One deliberate
  deviation from CLI behavior: the CLI stamps `plan_reviewed_at = now()`; this repair sets it to
  `null` instead, because no review occurred at that moment and `null` is the same value a
  never-reviewed spec carries.
- `flowctl validate fn-112-native-pdfjs-document-renderer` and the diff-check are
  **`pending_independent_orchestrator_run`** — Hermes runs them independently.

Structural self-checks that were possible read-only: the four clarifications are present in all three
markdown artifacts (verified by grep across spec md, task `.4` md, task `.5` md); the spec JSON
remains well-formed with only the three intended field changes plus `updated_at`.

## Scope statement

**No production or test code was changed.** No task was started or completed, no commit, push, or PR
was made, and no implementer or reviewer agent was invoked.

## Remaining gate

Independent **Sol plan review** (`gpt-5.6-sol`) of the repaired plan. Until it returns SHIP and the
spec's `plan_review_status` / `ready` are restored accordingly, task `.4` implementation must not
start.
