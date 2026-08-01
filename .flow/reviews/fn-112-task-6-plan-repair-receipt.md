# fn-112 task .6 — targeted plan repair receipt (P-3 / P-4a / P-4b)

**Date:** 2026-08-01 · **Owner:** host harness, `claude-opus-5`, effort medium ·
**Branch:** `feat/native-pdf-renderer` · **Base:** `bb994b580356a41a31093fea85b06993c1a18e4c`

**Scope of this transaction:** Flow spec/task artifacts and this receipt only. **No**
product or harness code was edited. Task .6 remains `in_progress` / unaccepted; task .7
remains `todo`; no commit, push, PR, or model/subagent invocation. **This is not a
verdict — only Sol reviews.** Ready for independent Sol targeted plan review.

## 1. Evidence anchored

- Task .6 transaction receipt (`.flow/reviews/fn-112-task-6-transaction-receipt.{json,md}`)
- `/tmp/fn112-smoke-run15.log`, run16, run17
- Opus round5 / round6 event logs (`fn-112-opus5-task6-ownership-round{5,6}.events.jsonl`)
- Sol targeted progressive plan review round 2 (`fn-112-sol-plan-rereview-task6-progressive-round2.json`)
- Read-only product inspection: `src/serve/public/hooks/use-pdf-pages.ts`,
  `src/serve/public/lib/pdf.ts:445-700`, `src/serve/public/components/pdf/PdfViewer.tsx`,
  `PdfToolbar.tsx`

## 2. Architectural vs harness classification

| Finding | Live evidence | Classification | Basis |
| --- | --- | --- | --- |
| **P-3 200 `renderStart` vs ≤ 60** | run15 fatal, run16 `BUDGET FAILURE`, `orphans=0 doubles=0 dropped=0` | **Product / architectural** | The measurement is complete and internally consistent. `use-pdf-pages.ts:497-758` starts a render inside `ensureRendered` for every page admitted to the live window, and `PdfPageView` invokes it on `active`. An N-page traversal issues N starts by construction — precisely the "a naive implementation fires ~200" case the spec's P-3 was written to forbid. Not environmental, not a harness artifact. |
| **P-4a 1223.9 ms vs ≤ 500 ms** | run16 bimodal samples (10 × ~137–211 ms, 10 × ~1100–1278 ms) | **Harness-only — invalid measurement** | The split matches the harness issuing 11 sequential driver clicks per 100 % → 200 % commit vs 1 for `zoomReset` (≈ 100 ms transport per round-trip). The measured quantity was automation IPC, not commit → settle. It is *not* evidence about the product either way. |
| **run17 batched-gesture attempt** | `zoomToPercent` timeout at `scripts/pdf-viewer-smoke.ts:1584-1588` | **Harness-only — also invalid** | Ten synchronous `btn.click()`s in one evaluation each close over the pre-commit `zoom`; React batching coalesces them to one effective step, so the target zoom never arrives. |
| **P-4b in-flight never observed** | run16 fatal after escalation; run17 failed earlier | **Harness-only — mechanism, not requirement** | Detection and the replacement commit were separated by a driver round-trip, so the in-flight window closed before the replacement landed. The requirement itself is attainable and stays verbatim. |
| **P-1, P-2, alignment, progressive oracle** | pass in run15–run17 (alignment after the `globals.built.css` rebuild) | No repair needed | — |

## 3. Architecture delta (the only product-behavior change)

**Deferred render admission** in `src/serve/public/hooks/use-pdf-pages.ts`.

- Entering the live window **schedules** a render instead of starting one.
- Admission requires `SCROLL_QUIESCENCE_MS ≈ 120 ms` of visible-set quiescence; any
  visible-set change re-arms the interval. Under P-3's 50 ms step cadence, an active
  scroll admits nothing, so starts are bounded by *scroll stops*, not *pages traversed*.
- Pages leaving the window before admission are dropped with **zero** metric events, so
  "exactly one terminal settle per start / zero orphans" is untouched.
- **Two exemptions**, each protecting another budget: deferral applies only once a render
  has already started for the current `(docId, genId)`. The first window of a document
  therefore starts immediately (P-1, progressive first paint) and every zoom/fit commit
  starts immediately (P-4a latency, P-4b in-flight observability).
- Pending admissions and the timer are cleared on doc change and in `disposeAll` (P-6).
- Everything downstream of admission is unchanged: gen-cancel, ceiling eviction,
  cancel → settle → `page.cleanup()` → zero-dims, DPR/area cap, slot updates.

**Ownership:** task .6, as an amendment to task .3/.4's accepted scheduler — the same
pattern already used for the `pdf.ts` range-mode loading policy. Tasks .1–.5 stay
accepted; their receipts are not reopened. R10 is already carried by task .6.

**Rejected alternatives** (recorded in the spec's Decision Context): a bounded concurrent
render queue (P-3 counts starts, not concurrency) and rAF-throttled admission (bounds
rate, not total).

## 4. Measurement repairs (no product change)

**P-4a.** A product commit is one zoom *step*; 100 % → 200 % is a sequence, 200 % → 100 %
is the single `zoomReset` commit. A traversal drives the alternating target through real
stepped commits, each issued only after the previous settled; **the sample is the
traversal's terminal commit**, whose render is a full re-render of the live window at the
target scale. 20 samples, ascending sort, 19th value ≤ 500 ms — unchanged. Non-terminal
step latencies are recorded as supplementary artifact data and asserted against nothing.
`t0` is `performance.now()` taken inside the same in-page evaluation as the single
dispatched gesture; `t1` is the matching `renderSettle(completed).t` — one clock, no
automation transport inside a measured window. Forbidden: multi-click evaluations, state
setters, harness-driven `zoom`/`genId`/`fitMode`, and any control added purely as
measurement scaffolding (a direct zoom-percentage input would be a product decision with
its own design review).

**P-4b.** Every requirement is preserved verbatim. Only the mechanism is specified:
detection and replacement inside **one** in-page evaluation (rAF poll over `snapshot()`,
replacement gesture dispatched synchronously the instant an unsettled `renderStart` for
the current gen appears), and an ordered escalation ladder — small @200 % → 200-page
@fit-width → 200-page @max zoom → larger viewport → `deviceScaleFactor: 2` — each rung
bounded, escalating on expiry, **failing loudly** after the last. No sleeps, no skips, no
downgrade.

## 5. Contracts explicitly unchanged

- **P-3 ≤ 60** `renderStart`; zero orphans; `dropped === 0`. Never relaxed; the measured
  miss is never reclassified as environmental.
- **P-4a ≤ 500 ms** at the 19th of 20 ascending samples. **P-4b** remains mandatory with a
  loud failure if in-flight is never observable.
- **P-1, P-2, P-5, P-6** thresholds and procedures.
- **`__gnoPdfMetrics` schema:** no new event kind, no new or altered field, no change to
  `reset` / `snapshot` / `export` semantics or the correlation invariants.
- **Strict progressive contract** and the held-Range oracle (honest `Range`-less
  pass-through, byte-accurate `206` slices, timing as the sole synthetic element, zero
  `pdf-state-*`, aspect oracle, release-in-`finally`).
- Offline / zero-non-`self` posture, security envelope, R8 states, aux-404 semantics,
  alignment, visual-QA matrix, package smoke.
- Tasks .1–.5 accepted behavior. No live evidence proves a defect in any of them; the
  D1/D2/D3 findings already recorded in the task-.6 transaction receipt stand as they are.

## 6. Artifacts changed in this transaction

| File | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | P-3: deferred-render-admission invariant + non-vacuity + measured-defect statement. P-4a: stepped-control commit semantics, terminal-commit sampling, in-page timestamp rule, forbidden shortcuts. P-4b: single-evaluation detection + ordered escalation ladder. `use-pdf-pages.ts` module row. New Decision Context entry with rejected alternatives. |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | Files list (+ `use-pdf-pages.ts` and its test). Three new Approach bullets (P-3 repair with algorithm/invariants/tests/evidence, P-4a protocol, P-4b mechanism). Commands (+ hook, component, `test:web` suites). Five new detailed acceptance items + two condensed ones. Key-context note recording this repair. |
| `.flow/reviews/fn-112-task-6-plan-repair-receipt.md` / `.json` | This receipt. |

No product file, harness script, test, or `.flow` lifecycle field was modified.

## 7. Exact open implementation work (task .6, still `in_progress`)

1. Implement deferred render admission in `use-pdf-pages.ts` per §3.
2. Add tests T1–T6 in `test/serve/public/hooks/use-pdf-pages.dom.test.tsx`; keep every
   pre-existing scheduler/`PdfPageView` test green and individually justify any timing
   expectation that legitimately changed.
3. Rework the P-4a measurement in `scripts/pdf-viewer-smoke.ts` per §4 (removing the
   batched-gesture `zoomToPercent` path).
4. Rework P-4b detection/escalation per §4.
5. Re-run `bun run smoke:pdf-viewer` end-to-end: P-3 ≤ 60 with non-vacuity, P-1/P-2/
   progressive unregressed, P-4a, P-4b, then the not-yet-reached P-5, P-6 and the
   visual-QA matrix.
6. Run the remaining gates: `bunx tsc --noEmit`, `bun run lint:check`, `bun test`,
   `bun run test:web`, `bun run test:e2e:pdf`, `bun run test:package`.
7. Report every budget number, pass or fail. Nothing is relaxed.

## 8. Flow validation

`.flow/bin/flowctl validate` results are recorded in the accompanying `.json`.

## 9. Readiness

Plan artifacts are internally consistent and ready for **independent Sol targeted plan
review** of: the P-3 architecture delta and its ownership placement, the P-4a
terminal-commit sampling equivalence, and the P-4b escalation ladder.
