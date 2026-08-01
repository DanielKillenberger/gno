# fn-112 — Opus plan repair round 3: progressive proof propagated into task .6

**Kind:** targeted plan clarification (no implementation)
**Spec:** `fn-112-native-pdfjs-document-renderer`
**Task touched:** `.6` only
**Model:** `claude-opus-5` · **Effort:** medium · **Session:** `4fc6c33e-828c-483a-b431-92956a1f64d2`
**Date:** 2026-07-31
**Responds to:** `.flow/reviews/fn-112-sol-plan-rereview-task4-b1-b2.json` — Sol (`gpt-5.6-sol`), verdict **REVISE**; sole blocker: the B1 progressive contract was fixed in the spec and task `.4` but task `.6` still said "delayed/chunked range responses", which is not an executable proof.
**Prior repairs:** `.flow/reviews/fn-112-opus-plan-repair-task-4-design.{md,json}`, `.flow/reviews/fn-112-opus-plan-repair-task4-sol-b1-b2.{md,json}`

## Resolution — event-driven held-Range procedure

Task `.6` Approach gains a dedicated **"Progressive state — event-driven
held-Range procedure"** bullet, and the old `progressive first page →
delayed/chunked range responses` clause now points at it. Both duplicated
Acceptance blocks gained a matching item.

**Aspect oracle.** `generateLargePdf(200)` emits unrotated Letter pages,
`MediaBox [0 0 612 792]` — verified against the implemented generator at
`scripts/generate-test-fixtures.ts:369`, so no change to task `.2`'s completed
contract was needed. Every page box therefore has ratio `612/792 = 17/22 ≈
0.772727…` at every scale. Assertion: `width > 0`, `height > 0`,
`Math.abs(width / height - 17/22) <= 0.01`. Drift guard: the smoke re-reads the
generated file's `MediaBox` (or the generator's exported page-size constant) and
**fails loudly** if it is not `[0, 0, 612, 792]`, rather than asserting a stale
ratio.

**Byte-accurate local Range server.** Interception-only Playwright context;
fixture bytes read in the smoke process; `page.route()` matches **only** that
fixture's `/api/doc-asset` URL. Every fulfilment is a `206` with correct
`Content-Range: bytes a-b/total`, `Accept-Ranges: bytes`, `Content-Length:
b-a+1`, sliced from the known bytes.

**`Range`-less first request** is answered with only the first canonical chunk
(64 KiB, clamped to file size) as a `206` with correct headers, so PDF.js keeps
issuing observable `Range` requests. Recorded explicitly as **synthetic
test-mode behavior**; the production endpoint is unchanged and this run never
feeds the clean zero-non-`self` claim.

**Queue instead of fulfil.** Later Range requests are pushed onto a queue with
their `route` objects held. Two event-driven controls: `nextQueuedRange()`
(promise resolving when a request enters the queue) and `releaseNextRange()`
(fulfils exactly one held request). **No fixed sleeps anywhere.**

**Release only until first paint.** Release one range at a time, each time
awaiting `page.waitForFunction(() => document.querySelector('[data-rendered="true"]') !== null)`
or the next queue event under the harness's ordinary assertion timeout, until a
`data-rendered="true"` node exists — then stop releasing.

**Guarantee a held later range.** Assert at least one later Range is queued and
held. If virtualization has not requested one, scroll
`[data-testid="pdf-page-column"]` just far enough to bring a later pending page
into the IntersectionObserver window — a scroll chosen to keep the first painted
page inside the live window so it is never evicted and first paint stays valid —
then `await nextQueuedRange()` and keep it held.

**Single-instant assertions** (one `page.evaluate` snapshot + the held-queue
count from the smoke process):

1. `[data-testid="pdf-page-column"]` exists
2. `>= 1` node with `data-rendered="true"`
3. `>= 1` node with `data-rendered="false"`
4. **zero** `[data-testid^="pdf-state-"]` nodes
5. held later-Range count `>= 1`
6. one chosen pending node: `width > 0`, `height > 0`,
   `|width/height - 17/22| <= 0.01`

**Evidence:** screenshot at that instant plus a request/control log (every
intercepted URL, each `Range` header, fulfilled-vs-held disposition, release
order, queue depth over time), run-mode labelled.

**Teardown:** all held routes released (and unrouted) in a `finally` block, so a
held request cannot hang page close or the harness.

**Evidence scope, stated in the artifact:** synthetic interception evidence for
the progressive *rendering* contract only. It proves nothing about real network
timing, streaming performance, or the zero-non-`self` posture — those come
exclusively from the clean, non-intercepted run.

## Changed paths

| Path | Change |
| --- | --- |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | Approach: R8-states bullet's progressive clause repointed; new dedicated event-driven held-Range procedure bullet (oracle, byte-accurate 206 server, 64 KiB first-chunk rule, queue/release controls, release-until-first-paint, guaranteed held later range, six single-instant assertions, evidence, `finally` teardown, synthetic-scope statement). Acceptance block 1: progressive clause repointed + new full progressive item. Acceptance block 2: new condensed progressive item |
| `.flow/reviews/fn-112-opus-plan-repair-task4-sol-progressive-task6.{md,json}` | This receipt |

**Unchanged:** no other plan changes. Task `.2`'s generator contract needed no
edit — the `[612, 792]` page size is already implemented and citable. Spec md,
tasks `.4`/`.5`, and every JSON sidecar untouched: spec stays
`plan_review_status: "unknown"`, `plan_reviewed_at: null`, `ready: false`; task
`.6` remains `todo`; completed task state and all prior receipts preserved.

## Sources

- `.flow/reviews/fn-112-sol-plan-rereview-task4-b1-b2.json` (blocker)
- `.flow/reviews/fn-112-opus-plan-repair-task4-sol-b1-b2.{md,json}` (round-2 repair, B1 contract)
- `.flow/specs/fn-112-native-pdfjs-document-renderer.md` — "Progressive state hook (explicit exemption)"
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md`, `.2.md`
- `scripts/generate-test-fixtures.ts:356-369` (`generateLargePdf`, `addPage([612, 792])`)
- `src/serve/public/globals.css:540-556`, `src/serve/public/components/pdf/PdfPageView.tsx` (`data-rendered` contract)

## Validation

Bash remains **permission-denied** for `flowctl` and `git diff`.

- `flowctl validate fn-112-native-pdfjs-document-renderer`: **`pending_independent_orchestrator_run`** (Hermes)
- diff-check: **`pending_independent_orchestrator_run`** (Hermes)
- Read-only self-checks: the `[612, 792]` oracle matches the implemented
  generator line-for-line; the procedure's hooks (`pdf-page-column`,
  `data-rendered`, `pdf-state-*`) match the spec's "Progressive state hook"
  subsection exactly; both duplicated task `.6` acceptance blocks carry the new
  item.

## Scope statement

**No production or test code was changed.** No task started or completed, no
commit, push, or PR, no implementer or reviewer agent invoked, no scope or
architecture change, no other plan edits.

## Remaining gate

Independent **Sol plan re-review** (`gpt-5.6-sol`, stage `plan-review`) of the
task `.6` propagation. Spec metadata stays `plan_review_status: "unknown"` /
`ready: false`; task `.4` implementation must not start until that review
returns SHIP.
