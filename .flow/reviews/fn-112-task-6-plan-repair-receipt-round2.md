# fn-112 task .6 — targeted plan repair receipt, **round 2** (Sol PR6-PERF-01..04)

**Date:** 2026-08-01 · **Owner:** host harness, `claude-opus-5`, effort medium ·
**Session:** `572493af-ac2e-4e7e-9804-37f80ea0074e` ·
**Branch:** `feat/native-pdf-renderer` · **Base:** `bb994b580356a41a31093fea85b06993c1a18e4c`

**Input:** `.flow/reviews/fn-112-sol-plan-review-task6-performance-round1.json` —
verdict **REVISE**, blockers PR6-PERF-01..04, observations N1..N4.
Supersedes round 1 (`fn-112-task-6-plan-repair-receipt.{md,json}`), which stays on disk
as the round-1 record.

**Transaction scope:** Flow spec/task artifacts and plan-repair receipts only. **No**
product, harness, or test code was edited. Task .6 stays `in_progress` / unaccepted, .7
stays `todo`; no commit, push, PR, subagent, or model invocation. **No verdict is issued
here — only Sol reviews.**

## Blocker dispositions

### PR6-PERF-01 — admission boundary — **REPAIRED**

The boolean `startedAtGenRef` is **withdrawn**. Sol's race is real in both directions:
flipped at `renderStart`, many concurrent callers read `false` across the
`doc.getPage()` await; flipped on first entry, exactly one page bypasses and the rest of
the initial window starves.

Replacement: an **admission epoch** `(docId, genId, epochSeq)`, where `epochSeq` is
bumped **synchronously** on every document and generation change and opening an epoch
opens its **exempt batch**.

- *Snapshot timing:* while the batch is open, every page passing the ordinary active-set
  guard is admitted — the whole initial window, and every active page after a zoom/fit
  commit. No single-instant snapshot is taken, because the correct exempt set is exactly
  "the pages active before the window next moves".
- *Closing rule:* the batch closes at the first visible-set mutation occurring **after**
  it has admitted ≥ 1 page. Requiring a prior admission is what makes cold start correct
  (there the IntersectionObserver mutation is itself what makes the initial pages
  active); requiring a *subsequent* mutation is what keeps later scroll entries from
  joining a batch that is already serving. A closed batch never reopens.
- *Across awaits:* admission is decided synchronously at `ensureRendered` entry, before
  any await, and carries an `epochSeq` token revalidated after every await alongside the
  existing dispose/gen/active checks. A mismatch abandons the attempt without starting.
- *Bound:* at most one window's worth of starts is exempt per epoch; P-3's scroll is a
  single epoch.
- *Tests:* T2 (multiple initial pages admitted immediately — multi-page, so a single-page
  bypass cannot pass), T3 (every active page admitted after a generation commit), T4
  (entries during continuous scrolling after the batch closed stay deferred).

### PR6-PERF-02 — pending ownership and timer races — **REPAIRED**

Pending entries now carry full identity `{docId, genId, epochSeq, pageNumber, canvas}`.
The map **and** its timer are invalidated and cleared on every **generation** change, on
document change, and on disposal. The timer callback captures the `epochSeq` it was armed
under and no-ops when stale; it **atomically claims** the map (copy, then clear) before
iterating and processes entries **sequentially** so ceiling eviction cannot race. Per
entry it revalidates in order: not disposed → current `docId`/`genId` → membership in a
freshly computed active set → `canvasRef.current.get(page) === entry.canvas` and
`canvas.isConnected` → no existing unsettled task at the current generation → live-canvas
ceiling headroom. Only then does it enter the clearly named **ungated**
`startRenderAdmitted` path, extracted from today's render body, which never consults the
gate — so a flush can neither re-defer recursively nor admit a page twice. Entries failing
any check are dropped with **no** metric event.

Tests extended as required: T3 stale-generation timer fires as a no-op after a commit; T5
disposal *during* timer expiry starts nothing; T6 canvas replacement between defer and
expiry, duplicate/re-entrant callbacks admitting each page at most once, ceiling
serialization across a multi-entry flush, and multiple final-window pages (also in T1).

### PR6-PERF-03 — P-4a semantics — **REPAIRED by product change, not by amendment**

The terminal-commit equivalence claim is **withdrawn**. P-4a is **not** amended, weakened,
or formally reconsidered: it keeps its 20 alternating 100% ↔ 200% commits, commit→settle
sampling, ascending sort and 19th-value ≤ 500 ms.

Instead the product gains the control the budget always presumed — a **zoom-level
combobox** on the existing `components/ui/select.tsx` primitive, replacing the zoom
group's percentage readout button:

- trigger shows the current percentage with an accessible name; fixed stops
  50/75/100/125/150/200/300/400 % — all inside existing `MIN_ZOOM` 0.25 / `MAX_ZOOM` 4, so
  both literal P-4a targets are single directly-selectable commits; no new zoom math, no
  new bounds;
- commit path is the existing one: `onZoomTo(level)` → `setZoom(clampZoom(level))`,
  `setFitMode("custom")`, `bumpGen()`, with **no** state or generation change when the
  level already equals the current zoom in `custom` fit mode (the accepted boundary rule);
- **stepped `+`/`−` unchanged**, including disabled states at the bounds and `stepZoom`
  snapping; reset-to-100 % preserved via the untouched keyboard shortcut and as an
  explicit option marked the default level;
- keyboard/a11y (R5): full Radix select operation, correct roles, visible focus ring,
  current level exposed as selected, disabled with `controlsDisabled`;
- process: `docs/adr/001-scholarly-dusk-design-system.md` + the `frontend-design` plugin
  per `src/serve/CLAUDE.md`; deterministic component tests; added to the R15 visual matrix
  with the listbox open.

R4/R5 now map to task .6 as well as .4; task .4's receipt stays accepted. Task .6's
`satisfies` gains R4. Harness-side, the measurement is 20 alternating **direct** commits
with `t0` from `performance.now()` inside the same in-page evaluation as the single
dispatched gesture and `t1` from the matching `renderSettle(completed).t`. Direct state
manipulation from the harness remains forbidden, and nothing may be added to the product
for measurement alone.

### PR6-PERF-04 — P-4b initiating-gesture race and no-op gestures — **REPAIRED**

Each attempt is now **one** in-page evaluation covering initiation as well: (1) baseline
snapshot, `genId`, `seqHigh`; (2) one initiating gesture on a control asserted **enabled**
and asserted to be a genuine state change; (3) rAF poll until a new `genId` shows a
`renderStart` at `seq > seqHigh` with no terminal settle; (4) **synchronous** dispatch of a
distinct, asserted-enabled replacement gesture in that frame; (5) proof of a second
distinct generation. If either gesture misses its expected generation transition the rung
**fails and escalates** — a click on a disabled or no-op control is never scored.

Named gesture pairs per rung: run A `select 200%` → `select 400%`; run B `select 300%` →
`fit-page` (valid because the select sets `custom` first); **max-zoom rung** (entry 400%,
`+` disabled and selecting 400% a no-op) `select 300%` → `select 400%`; where a rung's
entry state already has the intended fit mode active, the other mode is used. Each rung
records entry state and chosen pair and asserts enabled-and-not-a-no-op before dispatch.
No sleeps, no direct state, full ordered stream, cancellation ordering and stale-paint
proof all preserved.

## Non-blocking observations

- **N1 — incorporated.** `SCROLL_QUIESCENCE_MS` is stated as a **production behavior
  constant** in `use-pdf-pages.ts`, never harness-derived, injected, or tuned from the
  smoke. New **T7** covers both sides of the boundary with fake timers: a sustained
  cadence just under it admits nothing; a pause just over it admits.
- **N2 — preserved.** Task .6 continues to own the scheduler amendment (and now the R4/R5
  toolbar addendum) without reopening accepted receipts, on the same live-evidence /
  in-progress basis. Source, hook tests, smoke harness, component regressions and the
  type/lint/test/web/e2e/package gates are unchanged, extended only with the toolbar
  component tests.
- **N3 — preserved.** Nothing in this round relaxes P-1/P-2/P-5/P-6, the metrics schema or
  correlation oracle, progressive held-Range behavior, or the offline/security/auxiliary/
  alignment/visual/package contracts; tasks .1–.5 stay accepted.
- **N4 — re-run.** Results in §"Validation" below.

## Changed artifacts (round 2)

| File | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | P-3: boolean exemption replaced by admission epochs + pending-ownership/timer semantics; quiescence constant marked production-only with boundary tests. P-4a: terminal-commit sampling removed; R4 addendum specifying the zoom-level combobox; literal 20×100 %↔200 % form restored; forbidden-shortcuts paragraph updated. P-4b: whole-attempt single evaluation and per-rung gesture pairs. Toolbar module row; R4/R5 rows now include .6; new Decision Context entry for the combobox. |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | `satisfies` + R4. Files + toolbar/viewer sources and component tests. P-3 bullet rewritten (structure / epochs / pending ownership / invariants / T1–T7). P-4a bullet replaced with the combobox product change + literal measurement. P-4b bullet extended with single-evaluation attempts and named gesture pairs. Acceptance items updated and one added. Commands note. Key-context round-2 note. |
| `.flow/reviews/fn-112-task-6-plan-repair-receipt-round2.{md,json}` | This receipt. |

Round-1 receipts are left unmodified as the round-1 record.

## Contracts unchanged

P-1, P-2, P-5, P-6; **P-3 ≤ 60** with zero orphans and `dropped === 0`; **P-4a ≤ 500 ms**
at the 19th of 20 ascending samples over the literal 100 % ↔ 200 % operation; **P-4b**
mandatory with a loud failure; the `__gnoPdfMetrics` schema (no new kind, no field or
semantics change); the strict progressive held-Range oracle and range-mode loading policy;
offline zero-non-`self` posture, security envelope, R8 states, auxiliary-404 semantics,
alignment, visual matrix, package smoke; accepted tasks .1–.5. Stepped `+`/`−` zoom
behavior is explicitly unchanged.

## Open implementation work (task .6, still `in_progress`)

1. Implement admission epochs, pending ownership, and the ungated `startRenderAdmitted`
   split in `use-pdf-pages.ts`.
2. Add hook tests T1–T7; keep pre-existing scheduler/`PdfPageView` tests green and justify
   any changed timing expectation individually.
3. Implement the zoom-level combobox (`PdfToolbar.tsx`, `onZoomTo` in `PdfViewer.tsx`)
   through the ADR + `frontend-design` process; add component/a11y tests; update every test
   touching `pdf-toolbar-zoom-reset` individually.
4. Rework P-4a measurement in `scripts/pdf-viewer-smoke.ts` to 20 alternating direct
   commits with in-page timestamps.
5. Rework P-4b to whole-attempt in-page evaluations with the named per-rung gesture pairs
   and enabled/no-op assertions.
6. Re-run `bun run smoke:pdf-viewer` end to end: P-3 ≤ 60 with non-vacuity, P-1/P-2/
   progressive unregressed, P-4a, P-4b, then the not-yet-reached P-5, P-6 and the visual
   matrix (now including the combobox).
7. Gates: `bunx tsc --noEmit`, `bun run lint:check`, `bun test`, `bun run test:web`,
   `bun run test:e2e:pdf`, `bun run test:package`.
8. Report every budget number, pass or fail. Nothing is relaxed.

## Validation

| Check | Result |
| --- | --- |
| `.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer` | exit 0 — `Tasks: 7, Valid: True` |
| Receipt JSON parse | round-2 `.json` parses |
| `git diff --check` | clean |
| Lifecycle | .1–.5 done, .6 `in_progress`/unaccepted, .7 `todo` — unchanged |

## Readiness

All four blockers are addressed in the plan artifacts, N1 is incorporated and N2–N4 are
preserved. Ready for **Sol targeted plan re-review**; no implementation has begun and this
transaction ends at the plan re-review boundary.
