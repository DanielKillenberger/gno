# fn-112 — Opus plan repair round 2: Sol B1 + B2

**Kind:** targeted plan/spec clarification (no implementation)
**Spec:** `fn-112-native-pdfjs-document-renderer`
**Tasks touched:** `.4`, `.5`
**Model:** `claude-opus-5` · **Effort:** medium · **Session:** `4fc6c33e-828c-483a-b431-92956a1f64d2`
**Date:** 2026-07-31
**Responds to:** `.flow/reviews/fn-112-sol-plan-review-task4-repair.json` — Sol (`gpt-5.6-sol`), stage `plan-review`, verdict **REVISE**, blocking findings **B1** and **B2** (non-blocking O1–O3 required no action).
**Prior repair:** `.flow/reviews/fn-112-opus-plan-repair-task-4-design.{md,json}`

## B1 — Progressive hook contradiction

**Finding.** The canonical table gave Progressive no hook (it is only the page
column plus placeholders), while task `.4` required every designed state to
carry a stable state-card hook. Both could not be satisfied literally, and task
`.6` still needs deterministic progressive evidence.

**Resolution — explicit exemption plus a canonical non-card hook.** No card, no
copy, no `pdf-state-progressive` id is introduced.

New spec subsection **"Progressive state hook (explicit exemption)"**:

- Progressive is a rendering *phase* of the ready document, not a state card.
  Wherever the spec or a task says "every designed state carries a stable test
  hook", Progressive is exempt from the `pdf-state-*` **form** and satisfies the
  requirement through the page-column hooks. The seven-state list is unchanged.
- Canonical hooks (already implemented in task `.3`): `data-testid="pdf-page-column"`
  (the scroll container, task `.4`) plus per-page nodes carrying
  `data-rendered="false"` while unrendered and `data-rendered="true"` once
  painted (existing `.gno-pdf-page[data-rendered]` contract,
  `globals.css:540-556`), plus the existing per-page test id.
- **Task .6 driving and assertions**, stated exactly: drive the large fixture
  with Playwright `page.route()` delaying `/api/doc-asset` range responses (R18),
  then assert without sleeps — (1) `[data-testid="pdf-page-column"]` exists;
  (2) at least one `[data-rendered="true"]` node exists; (3) **simultaneously**
  at least one `[data-rendered="false"]` node exists with non-zero
  width/height matching its `getViewport` aspect; (4) zero
  `[data-testid^="pdf-state-"]` nodes. Screenshot at that moment is the R8
  progressive evidence artifact.

R8, the canonical-copy table row, and both task `.4` touchpoints (Key context +
the "each designed state carries a stable test hook" acceptance item) now state
the exemption, so "every state hook" can no longer be read as requiring a
progressive card. Task `.4` also gains a DOM assertion that progressive renders
zero `pdf-state-*` nodes while both a rendered and an unrendered page node exist.

## B2 — Fallback predicate, copy, actions

**Finding.** The fallback contract was internally contradictory and incomplete:
notices only when extracted text is available, yet a required "notice combined
with the empty/whitespace No extracted text sub-state"; `extractedTextAvailable`
never defined; only the corrupt notice had canonical copy.

**Resolution.**

### B2.1 Exact predicate

New spec subsection **"`extractedTextAvailable` — exact predicate (single
definition)"**. Verified executable against the current `DocData` interface
(`DocView.tsx:78-92`: `content: string | null`, `contentAvailable: boolean`):

```
const extractedTextAvailable =
  doc.contentAvailable === true &&
  typeof doc.content === "string" &&
  doc.content.trim().length > 0;
```

Evaluated per render from `doc`; not cached, not derived from mime/ext, does not
consider frontmatter. Consequence stated as binding on tasks `.4`, `.5`, `.6`:
**fallback never fires for null, empty, or whitespace-only extracted text**,
including every scanned PDF — those keep the viewer's actionable error card on
`Pages`.

### B2.2 Impossible combination removed

The "No extracted text for this document." sub-state is now defined as reachable
**only by manual `Text` selection**, never accompanied by a fallback notice. The
unreachable combined requirement is deleted from the spec frontend contract, R9,
and task `.5` (approach bullet, test list, and both acceptance blocks), and task
`.5` records why it was unreachable rather than silently dropping it.

### B2.3 Canonical fallback-notice copy (all four reasons)

New spec subsection **"Canonical fallback-notice copy (task .5; DocView Text
branch)"** — distinct from the viewer's cards, which are mutually exclusive with
notices by construction:

| Reason | Hook | Eyebrow | Body | Actions |
| --- | --- | --- | --- | --- |
| `corrupt` | `pdf-fallback-corrupt` | `CANNOT RENDER` | `This PDF could not be rendered. View the extracted text or download the original.` | `Download original` |
| `password` | `pdf-fallback-password` | `PASSWORD PROTECTED` | `This PDF is password protected. Showing the extracted text instead. Download the original to open it in a PDF reader.` | `Download original` |
| `network` | `pdf-fallback-network` | `COULD NOT LOAD` | `The document could not be loaded from this session. Showing the extracted text instead. Switch to Pages to try again, or download the original.` | `Download original` |
| `bootstrap` | `pdf-fallback-bootstrap` | `VIEWER UNAVAILABLE` | `The PDF viewer could not start in this window. Showing the extracted text instead. Download the original to read it.` | `Download original` |

- The `corrupt` string is the approved register string, byte-exact, and is the
  only place it appears in the product.
- **Action set is exactly one control per notice: `Download original`.** No
  retry control: retrying means switching back to `Pages`, which the existing
  `showRawView` pill already does and which is the same action that clears the
  notice; a second control would give two paths to one behavior and would need
  state the toggle contract does not have. The `network` copy names that path in
  words. This keeps the notice coherent with the existing
  showRawView/notice-clearing contract.
- Exactly one `pdf-fallback-*` node at a time, never together with a
  `pdf-state-*` node.

No implementer-authored copy remains anywhere in the task `.4`/`.5` state or
notice surfaces.

## Changed paths

| Path | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | Canonical-copy table progressive row → exemption pointer; new subsections "`extractedTextAvailable` — exact predicate", "Canonical fallback-notice copy", "Progressive state hook (explicit exemption)"; frontend-contract fallback + scanned-text bullets; R8 (progressive exemption), R9 (predicate, no-combination, canonical notices) |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.4.md` | Fallback rule → exact predicate as a passed-in boolean the viewer never re-derives; Key context → progressive exemption + canonical hooks + prohibition on adding a progressive card; two acceptance items (canonical copy exemption, per-state hooks incl. progressive DOM assertion) |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.5.md` | Fallback bullet → exact predicate + canonical notice table + no-retry rationale; empty-extracted-text bullet → unreachable combination removed with reason; DOM-test list → string-exact notices, predicate table test, zero-`pdf-fallback-*` assertion; both duplicated acceptance blocks |
| `.flow/reviews/fn-112-opus-plan-repair-task4-sol-b1-b2.{md,json}` | This receipt |

**Unchanged:** no task JSON touched (`.4` and `.5` remain `todo`, unclaimed); spec
JSON left at `plan_review_status: "unknown"`, `plan_reviewed_at: null`,
`ready: false`; completed task acceptance state, done summaries, evidence, and
all prior receipts (including `.flow/reviews/fn-112-baseline-receipt.json` and
the Sol review history) preserved unedited.

## Sources

- `.flow/reviews/fn-112-sol-plan-review-task4-repair.json` (B1, B2, O1–O3)
- `.flow/reviews/fn-112-opus-plan-repair-task-4-design.{md,json}` (round-1 repair)
- `.flow/specs/fn-112-native-pdfjs-document-renderer.md`; tasks `.4`, `.5`, `.6`
- `src/serve/public/pages/DocView.tsx:78-92` (`DocData.content` / `contentAvailable` — predicate verified executable), `:1583-1607`, `:1609-1615`
- `src/serve/public/components/pdf/PdfPageView.tsx`, `src/serve/public/globals.css:540-556` (`data-rendered` contract)
- `docs/adr/001-scholarly-dusk-design-system.md`

## Validation

Bash remains **permission-denied** for `flowctl` and `git diff` in this session.

- `flowctl validate fn-112-native-pdfjs-document-renderer`: **`pending_independent_orchestrator_run`** (Hermes)
- diff-check: **`pending_independent_orchestrator_run`** (Hermes)
- Read-only self-checks performed: the predicate matches the live `DocData`
  interface field-for-field; B1 and B2 edits are present in spec md, task `.4`
  md, task `.5` md, including both of task `.5`'s duplicated acceptance blocks.

## Scope statement

**No production or test code was changed.** No task started or completed, no
commit, push, or PR, no implementer or reviewer agent invoked, no architecture
or scope change, palette/type system untouched.

## Remaining gate

Independent **Sol plan re-review** (`gpt-5.6-sol`, stage `plan-review`) of the
B1/B2-repaired plan. Spec metadata stays `plan_review_status: "unknown"` /
`ready: false` until that review returns SHIP; task `.4` implementation must not
start before then.
