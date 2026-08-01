# fn-112 task .6 — targeted plan repair receipt, **round 3** (Sol PR6-PERF-05)

**Date:** 2026-08-01 · **Owner:** host harness, `claude-opus-5`, effort medium ·
**Session:** `572493af-ac2e-4e7e-9804-37f80ea0074e` ·
**Branch:** `feat/native-pdf-renderer` · **Base:** `bb994b580356a41a31093fea85b06993c1a18e4c`

**Input:** `.flow/reviews/fn-112-sol-plan-rereview-task6-performance-round2.json` — verdict
**REVISE**, one remaining blocker **PR6-PERF-05**; PR6-PERF-01/-02/-03 **closed**, N1–N4
preserved. Round-1 and round-2 receipts remain on disk as their rounds' records.

**Transaction scope:** Flow spec/task artifacts and this receipt only. **No** product,
harness, or test code was edited. Task .6 stays `in_progress`/unaccepted, .7 stays `todo`;
no commit, push, PR, subagent, or model invocation. **No verdict is issued here — only Sol
reviews.**

## PR6-PERF-05 — **REPAIRED**

Sol's feasibility contradiction is accepted in full: Radix closes and unmounts its
portalled listbox on selection, so a second selection at the in-flight observation frame
would require reopening the trigger and awaiting a portal remount. That yield lets the
superseded render settle and rebuilds exactly the race the repair exists to remove.
Pre-opening rescues the *initiating* selection only — and P-4a, where the open precedes
`t0`. Every P-4b replacement is therefore moved off the combobox.

### Initiation — feasible, with readiness proven before the baseline

The attempt evaluation is `async`. Awaiting *inside* it is allowed and necessary; what is
forbidden is a driver round-trip anywhere, and any yield between the in-flight observation
and the replacement dispatch. Ordered steps:

1. establish and assert the entry state, then **pre-open** the combobox and `await` its
   portalled listbox and target option being mounted and enabled — readiness is proven,
   and the rung fails if the option never mounts;
2. capture the baseline (`snapshot()`, `genId`, `seqHigh`) **after** readiness, so no
   portal-mount latency sits inside the measured window;
3. activate one option as the initiating gesture (asserted enabled, asserted a genuine
   state change);
4. rAF-poll until a new `genId` shows a `renderStart` at `seq > seqHigh` with no terminal
   settle;
5. **synchronously**, in that frame, dispatch the replacement on a distinct **already
   mounted** control;
6. confirm a second distinct generation with its own `renderStart`.

Nothing is awaited between steps 4 and 5.

### Replacement — always an already-mounted toolbar control

Entry is always **100 % / `custom`**, established before the attempt by selecting 100 %
(a real commit from the fit-width default, since `fitMode` changes) and letting it settle.
**No rung ever enters at `MAX_ZOOM`**, so the stepped `+` is enabled at every observation
point and never a boundary no-op. One coherent protocol, exact targets:

| Run | Entry | Initiate (pre-opened combobox) | Gen 1 | Synchronous replacement (mounted) | Gen 2 |
| --- | --- | --- | --- | --- | --- |
| A — zoom→zoom | 100 % / custom | `select 200%` | 200 % / custom | toolbar zoom-in `+` | 210 % / custom |
| B — zoom→fit | 100 % / custom | `select 300%` | 300 % / custom | toolbar `fit-page` | fit `page` |
| C — heavy load | 100 % / custom | `select 300%` | 300 % / custom | toolbar zoom-in `+` | 310 % / custom |

- Run A's replacement is real: `stepZoom(2.0, 1) = 2.1 ≠ 2.0`, and `+` is enabled below
  `MAX_ZOOM`.
- Run B's is real because the initiating selection sets `fitMode: "custom"`, so **both**
  fit buttons are unpressed at the observation point regardless of entry fit mode. If a
  variant ever enters with `page` already active, the fit gesture is the other mounted
  button, `fit-width`.
- Run C carries the heavy workload through the **environment** — 200-page fixture, larger
  viewport, `deviceScaleFactor: 2` — never through a max-zoom entry. That is why its
  replacement stays an enabled `+` (`stepZoom(3.0, 1) = 3.1`), and it is why the
  alternative "enter at 400 %, zoom-out 390 → 380" protocol is **not** adopted: a single
  protocol with no max-zoom entry is coherent across every rung.
- The ladder rung formerly described as "200-page fixture at maximum zoom" is renamed to
  the run-C higher-zoom commit, so no rung's entry state can disable the replacement.

Before every dispatch the rung asserts: the control is present in the DOM, is not
`disabled`, and its target differs from current state (`data-pressed !== "true"` for fit
buttons). Each rung records entry state, portal-readiness proof, selected initiating
option, mounted replacement control, and expected vs observed first/second generations
with their resulting zoom/fit targets. Missing readiness, a failed enabled/non-no-op
assertion, or a missing generation transition **fails the rung and escalates**.

### Escalation and run coverage

Ladder: small fixture run A → 200-page run A → 200-page run C → run C with a larger
viewport → run C at `deviceScaleFactor: 2`; each rung bounded, escalating on expiry,
failing loudly after the last. Run B is executed at the rung where run A first succeeded
and escalates the same way if its own in-flight window cannot be observed there. Both runs
must succeed — "≥ 2 overlapped runs" is not one run repeated.

### Preserved verbatim

Single page-evaluation attempt; baseline + `seq > seqHigh` in-flight proof; synchronous
replacement in the observation frame; second-generation proof; `renderCancel` →
`renderSettle(cancelled)` → replacement `renderStart` ordering; no completed settle on the
superseded generation; no stale paint (visible canvas backing dims match the replacement
generation); full ordered event stream stored per run; escalation ladder; no sleeps; no
direct state manipulation; loud final failure if in-flight is never observable.

## Closed blockers and observations

PR6-PERF-01, -02 and -03 are closed by Sol and were **not** reopened or altered in this
round. N1 (production-only quiescence constant + fake-timer boundary tests), N2, N3 and N4
remain preserved. Sol's -01-CLOSED note that implementation tests should make the
close-before-new-entry ordering explicit is already covered by T4 (post-close scroll
entries stay deferred) and is carried forward as implementation guidance.

## Changed artifacts (round 3)

| File | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | P-4b: attempt steps renumbered to 1–6 with pre-open/portal-readiness before the baseline and an explicit `async`-evaluation/no-yield rule; new paragraph forbidding a second combobox selection as replacement, with the Radix unmount rationale; gesture-pair prose replaced by the run A/B/C table with entry states and exact gen-1/gen-2 targets; ladder rungs restated so none enters at max zoom; run-B coverage requirement added. |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | P-4b approach bullets rewritten to match (async evaluation + readiness, no-second-selection rule, runs A/B/C with targets, restated ladder and run-B coverage); both P-4b acceptance items updated; key-context round-3 note. |
| `.flow/reviews/fn-112-task-6-plan-repair-receipt-round3.{md,json}` | This receipt. |

Rounds 1 and 2 receipts left unmodified.

## Contracts unchanged

P-1, P-2, P-5, P-6; **P-3 ≤ 60** with zero orphans and `dropped === 0`; **P-4a ≤ 500 ms**
at the 19th of 20 ascending samples over the literal 100 % ↔ 200 % operation; **P-4b**
mandatory with a loud failure; the `__gnoPdfMetrics` schema; the progressive held-Range
oracle and range-mode loading policy; offline zero-non-`self` posture, security envelope,
R8 states, auxiliary-404 semantics, alignment, visual matrix, package smoke; accepted
tasks .1–.5; stepped `+`/`−` zoom behavior; the admission-epoch and pending-ownership
designs closed in round 2; the zoom-level combobox specification closed in round 2.

## Open implementation work (task .6, still `in_progress`)

Unchanged from round 2, with item 5 restated: implement admission epochs + pending
ownership + `startRenderAdmitted`; hook tests T1–T7; the zoom-level combobox via ADR +
`frontend-design` with component/a11y tests and individually justified updates to every
`pdf-toolbar-zoom-reset` test; P-4a as 20 alternating direct commits on the in-page clock;
**P-4b as whole-attempt async evaluations with pre-opened combobox initiation and
already-mounted replacement controls per runs A/B/C**; full smoke re-run including the
not-yet-reached P-5, P-6 and visual matrix; gates (`bunx tsc --noEmit`,
`bun run lint:check`, `bun test`, `bun run test:web`, `bun run test:e2e:pdf`,
`bun run test:package`); every budget number reported, pass or fail, nothing relaxed.

## Validation

| Check | Result |
| --- | --- |
| `.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer` | exit 0 — `Tasks: 7, Valid: True` |
| Receipt JSON parse (rounds 1, 2, 3) | all parse |
| `git diff --check` | clean |
| Lifecycle | .1–.5 done, .6 `in_progress`/unaccepted, .7 `todo` — unchanged |

## Readiness

The sole remaining blocker is addressed; closed blockers and observations are untouched.
Ready for **Sol round-3 targeted plan re-review**. No implementation has begun and this
transaction ends at the re-review boundary.
