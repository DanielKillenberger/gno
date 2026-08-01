# fn-112 review & evidence ledger

Consolidated, durable record for spec `fn-112-native-pdfjs-document-renderer`.

This PR retains a **minimal canonical receipt set** (listed under "Retained
artifacts" below). Every other review round, orchestration transcript, raw gate
log, and browser/QA artifact produced during the build was removed from version
control during PR hygiene: they are session-specific, superseded by a terminal
verdict, or mechanically regenerable. Their substance is preserved here as
verdicts, measurements, and SHA-256 provenance.

## Retained artifacts and why each one stays

| Path | Why it must stay |
| --- | --- |
| `fn-112-baseline-receipt.json` | Durable pre-implementation baseline at base `bb994b58`. Task `.7` names this exact path as an R17 completion dependency; the gate compares per-command failures against its `captures[]`. Cannot be summarized away. |
| `fn-112-baseline-receipt.md` | Human-readable rendering of the same capture (`cap-001`), including per-command exit codes, counts, and raw-log SHA-256s. |
| `fn-112-sol-plan-review-round6.json` | Terminal SHIP of the plan-review pipeline stage. Rounds 1–5 were REVISE and are superseded; the accepted plan itself is the retained spec. |
| `fn-112-sol-impl-rereview-task-1-round4.json` | Terminal independent SHIP for task `.1` (doc-asset hardening, vendor routes, CSP). |
| `fn-112-sol-impl-rereview-task-2-round3.json` | Terminal independent SHIP for task `.2` (pin, bootstrap lib, fixtures). |
| `fn-112-sol-impl-rereview-task-3-round5.json` | Terminal independent SHIP for task `.3` (page rendering core, text layer, virtualization). |
| `fn-112-sol-impl-rereview-task-4-round3.json` | Terminal independent SHIP for task `.4` (viewer shell, designed states, a11y). |
| `fn-112-sol-impl-rereview-task-5.json` | Terminal independent SHIP for task `.5` (DocView integration, Pages/Text, fallback). |
| `fn-112-sol-impl-rereview-task-6-round7.json` | Terminal independent SHIP for task `.6` (browser smoke, P-1…P-6, package smoke). |
| `fn-112-task-7-sol-round4.out.md` | Terminal independent SHIP for task `.7` (docs, CHANGELOG, final gates). |
| `fn-112-spec-completion-sol-round1.out.md` | Spec completion review — per-requirement R1–R19 disposition, SHIP. The single most load-bearing acceptance record. |
| `fn-112-qa-evidence/qa-verdict.json` | Live-app QA ship verdict with per-scenario observed values. The Live QA Gate forbids deriving PASS from source, so the recorded observations must survive. |
| `fn-112-task-6-gates/negative-control.sh` | Re-runnable proof that the task `.6` assertions are non-vacuous (mutate guard → test fails → restore → passes). A script, not a log; its value is in re-execution. |
| `fn-112-task-7-gates/INDEX.md` | Final gate summary: baseline comparison outcome, tolerated pre-existing failures (none), and the base-commit reproduction of the unrelated `bun run build` failure. |
| `fn-112-review-ledger.md` | This file. |

Also retained outside `reviews/`: `.flow/specs/`, `.flow/tasks/` (canonical
intent), and `.flow/handoff/fn-112-gno-sh-docs-brief.md` (named by task `.7` as
an in-repo completion dependency).

## Independent review history (all rounds)

Reviewer: Sol, canonical model `gpt-5.6-sol`, read-only mode. Terminal verdict
for every scope was SHIP. Rows marked "removed" no longer exist in git; the
truncated SHA-256 records what was reviewed.

| Receipt | Verdict | sha256 | Status |
| --- | --- | --- | --- |
| `fn-112-sol-final-plan-review.json` | REVISE | `f76ab61c05c5683e…` | removed |
| `fn-112-sol-impl-rereview-task-1-round3.json` | NEEDS_WORK | `66a87216a500dadc…` | removed |
| `fn-112-sol-impl-rereview-task-1.json` | NEEDS_WORK | `3172c4e6b0bc38e7…` | removed |
| `fn-112-sol-impl-rereview-task-2.json` | NEEDS_WORK | `33f1c2efa659c661…` | removed |
| `fn-112-sol-impl-rereview-task-3-round3.json` | NEEDS_WORK | `c38fdef22d9c3e96…` | removed |
| `fn-112-sol-impl-rereview-task-3-round4.json` | NEEDS_WORK | `cfe250250c2e0918…` | removed |
| `fn-112-sol-impl-rereview-task-3.json` | NEEDS_WORK | `30dd512e5d80c837…` | removed |
| `fn-112-sol-impl-rereview-task-4.json` | NEEDS_WORK | `b8e1486fcd00fb7f…` | removed |
| `fn-112-sol-impl-rereview-task-6-round2.json` | NEEDS_WORK | `6d25ee3cf96b2503…` | removed |
| `fn-112-sol-impl-rereview-task-6-round3.json` | NEEDS_WORK | `c752b93f1d08a2ff…` | removed |
| `fn-112-sol-impl-rereview-task-6-round4.json` | NEEDS_WORK | `0b98403bf2b8d2d1…` | removed |
| `fn-112-sol-impl-rereview-task-6-round5.json` | NEEDS_WORK | `4eb3b7bee6f5b883…` | removed |
| `fn-112-sol-impl-rereview-task-6-round6.json` | NEEDS_WORK | `03a32e54e33c16e1…` | removed |
| `fn-112-sol-impl-review-task-1.json` | NEEDS_WORK | `e3673d2a76007521…` | removed |
| `fn-112-sol-impl-review-task-2.json` | NEEDS_WORK | `55d847e7f66a24f9…` | removed |
| `fn-112-sol-impl-review-task-3.json` | NEEDS_WORK | `cf8d0c38e42734ce…` | removed |
| `fn-112-sol-impl-review-task-4.json` | NEEDS_WORK | `007b2c16ec2f73ab…` | removed |
| `fn-112-sol-impl-review-task-5.json` | NEEDS_WORK | `da9eb1c6e177cd5f…` | removed |
| `fn-112-sol-impl-review-task-6.json` | NEEDS_WORK | `dac0ed38f959a203…` | removed |
| `fn-112-sol-plan-rereview-task4-b1-b2.json` | REVISE | `32782957b753b7af…` | removed |
| `fn-112-sol-plan-rereview-task4-progressive-final.json` | SHIP | `44b98eaf1b66904b…` | removed |
| `fn-112-sol-plan-rereview-task6-performance-round2.json` | REVISE | `76546d229d3b802f…` | removed |
| `fn-112-sol-plan-rereview-task6-performance-round3.json` | SHIP | `78e12260d822a92e…` | removed |
| `fn-112-sol-plan-rereview-task6-progressive-round1.json` | NEEDS_WORK | `e3ca6e16d03bd8eb…` | removed |
| `fn-112-sol-plan-rereview-task6-progressive-round2.json` | SHIP | `bf9a8bb563f83739…` | removed |
| `fn-112-sol-plan-rereview.json` | REVISE | `052a55670adb38c6…` | removed |
| `fn-112-sol-plan-review-round4.json` | REVISE | `7a48e81c07009d08…` | removed |
| `fn-112-sol-plan-review-round5.json` | REVISE | `6b803a1095b1b4a0…` | removed |
| `fn-112-sol-plan-review-task4-repair.json` | REVISE | `2889482fb421bd7e…` | removed |
| `fn-112-sol-plan-review-task6-performance-round1.json` | REVISE | `99300d5e3ae38521…` | removed |
| `fn-112-sol-plan-review.json` | REVISE | `532a0e0cbd8b3a19…` | removed |

## Measured performance results (task `.6`, browser evidence)

Captured 2026-08-01 on linux/x64, Bun 1.3.14, headless Chromium. Source
`evidence.json` (sha256 `319e00bb6f09198c75cbfc00938b1fa10f5a50ea0e7e2d34abdf358b40e5b7d8`)
was removed; it is regenerable with `bun run test:e2e:pdf`.

| Budget | What it bounds | Result |
| --- | --- | --- |
| P-1 | First page paint | 388.4 ms small fixture / 2087.9 ms large fixture |
| P-2 | Live canvases during traversal | 3, 0, 2, 0, 2 — bounded, never unbounded growth |
| P-3 | Render starts on a 200-page traversal | 6 starts, 6 settles, 0 orphans, 0 doubles, 0 dropped |
| P-4a | Zoom 100% → 200% latency | n=20, median 47.5 ms, p95 52.0 ms, max 67.1 ms |
| P-4b | Superseded-render cancellation | 2 runs (210% and fit-page); cancel → replacement ordering held |
| P-5 | Canvas resolution caps | effective DPR 1 (max 2); largest start area 1,938,816 px vs 16,777,216 px cap |
| P-6 | Document teardown | destroy seq 7, 0 late starts, 0 dropped |

`budgetFailures: []` and `failures: []` — no budget was exceeded.

Behavioral results from the same run: `nonSelfRequests: 0` (no non-`'self'`
traffic), `jsActionDialog: false` (embedded PDF JavaScript inert), text-layer
alignment within 6 px at 100%, fit-width, and 200%, and all seven designed
states (`loading`, `progressive`, `empty`, `corrupt`, `password`, `network`,
`bootstrap`) observed.

Observed `/api/doc-asset` response headers: `200`, `accept-ranges: bytes`,
`cache-control: no-store`, `content-disposition: inline; filename*=UTF-8''…`,
and the full security envelope including `worker-src 'self'`,
`frame-ancestors 'none'`, `object-src 'none'`.

## Live QA

8/8 scenarios PASS, 0 P0/P1/P2 findings, verdict SHIP, driven with
Playwright/Chromium against a real server on an isolated temp config.

The **entire** `fn-112-qa-evidence/` directory is retained: the verdict with its
per-scenario observations, all seven screenshots, the captured browser console
output, the request capture, the run output, and the session driver script. An
earlier pass of this cleanup removed the screenshots and captures; that was
wrong and was reverted. The Live QA Gate forbids deriving PASS from source, and
two scenarios depend on captures rather than on recorded scalars: QA-5 records
`scaleAfterReset=metrics-unavailable(visual check)`, so its screenshot **is**
the evidence, and QA-10's `foreignRequests=0` is backed by `requests.json` and
`console.log`. Deleting them would have left those PASS verdicts unsupported.

## Negative control

`fn-112-task-6-gates/negative-control.sh` — `OVERALL=PASS`: with the guard
mutated the targeted assertion fails (exit 1), after byte-identical restoration
it passes (exit 0). Its log output was removed; re-run the script to reproduce.

## Task `.6` browser artifact hashes (files removed, provenance kept)

| Artifact | sha256 |
| --- | --- |
| `CLEAN__cjk-cmap.png` | `74a734baeffd4fbf830662ccf1f93a0c8d46432dedcfe4b42bb2d45c839e063b` |
| `CLEAN__js-action.png` | `2482d5c35037795dc23f2316e856c2d25b1adbd4da196a073fe47b2e57eb1321` |
| `CLEAN__standard-font.png` | `cae61e62bde38ea044fff4ac11da8da42a94b574ded9f3396f7b1149e4caabce` |
| `CLEAN__viewer-links-rendered.png` | `162a8b987077c1eed8c1c831577f58da18f264686eacda2a2fa58f2ef51c8c5b` |
| `INTERCEPTION__align-100.png` | `c6aade4110b111f6801ba82abfb1597cb974f21c2a8cc5041dee2595ad92478f` |
| `INTERCEPTION__align-200.png` | `02bfcada5954f858090b8a2d947400344af83ae04d190ad9561d461ff6dc1635` |
| `INTERCEPTION__align-fit-width.png` | `c2d49a9979212280af206e09171196428c9806a4f3f278b8a646fb7639caafb1` |
| `INTERCEPTION__state-bootstrap.png` | `1cd1eef4d256bf0ba28dd18d38ecf0ed195a0ef8b9e393a5c014f9f9cd68ef91` |
| `INTERCEPTION__state-corrupt.png` | `e4ce4541062ac74d0700ca20482321d4d7663d3bd68af4d175b898d584896375` |
| `INTERCEPTION__state-empty.png` | `81cfe2d5be7eab6afc562dfb482ba0d108e728302b6dd7f3af538cf300028f84` |
| `INTERCEPTION__state-loading.png` | `11e2e1bc28ae14c5055d0155b65e805ae08820d39159e2a5ae83984c494e2dfb` |
| `INTERCEPTION__state-network.png` | `55bf0697ba034a4e54138d2937592f602564214d5fff808e91504596386d7670` |
| `INTERCEPTION__state-password.png` | `97a620565a7dc05dc3c50a71c5c05e9604c5165edfe5b4ad7867ed91ccf86062` |
| `INTERCEPTION__state-progressive.png` | `9123b00a1b0e18e781669c83ef49be12a78d3e016f060fde39a24bb81baf7adc` |
| `INTERCEPTION__visual-dark-w1380-overview.png` | `a66ceac2dd1e176b466440fbc17043748b29b7e2c5ad84072960bc97b5e226dc` |
| `INTERCEPTION__visual-dark-w1380-rail.png` | `c9721d484a2d99b7e8ad17d982a6eb03a5757d6e3dce5ab144d912ebbc0628ec` |
| `INTERCEPTION__visual-dark-w900-overview.png` | `20c570d06055ceaad10baaebeb5d66d362f4af5bfbca33557871837a38ba2210` |
| `INTERCEPTION__visual-dark-w900-rail.png` | `d7392eabb8b9f0f1770f849765c40923b1944a48616a95f2a194649fefb388dd` |
| `INTERCEPTION__visual-light-w1380-overview.png` | `f51effc5cd2c76a7c1ec14db27968330c5164cd1d71a826a86ee66c4ca2be6b5` |
| `INTERCEPTION__visual-light-w1380-rail.png` | `f3d3548e1fc3142be70d2f18a6f73d97b528110c55415b8aab31fe3679c7b8c6` |
| `INTERCEPTION__visual-light-w900-overview.png` | `69859c91f05dbbee12d9d8fd1f521c0eaabb715a5d639fc13020eb9f92d65610` |
| `INTERCEPTION__visual-light-w900-rail.png` | `746ebe09a89132fc62f1d2f93680fe5084201ccd4005bf3b4c51dc6d6b06fe4c` |
| `console-log.json` | `7699937bf3ee3f04cea13d24f85556fd67019a6c7e04065f1e7fa344fce358ae` |
| `evidence.json` | `319e00bb6f09198c75cbfc00938b1fa10f5a50ea0e7e2d34abdf358b40e5b7d8` |
| `p3-metrics.json` | `ae0199ffaec294686083486a4349d95391c4970cffb757e7215daea1891471d3` |
| `p4a-metrics.json` | `d128c022d959998b554941775bfe5f65ba6874ce416840927de3925fb5e19422` |
| `p4a-samples.json` | `94efce47c11389d55d6f2fcbb93fe5d6a7ed5ce8b3bb30820e85481d87e75b68` |
| `p4b-events.json` | `d70d1d777425ac2004538b0e5e6384c216f07a4506446956c3d8f20e32511097` |
| `p4b-ladder.json` | `f657654e8d8afaebde8ebc488f97d4e6d7d82256f29adc38f02dab04119a2347` |
| `p5-metrics.json` | `1284cc764b046fb0cdc9bccd354bff3e2707ba65a4072332bcf4c0b21661741e` |
| `p6-metrics.json` | `84b8633ecfae3c0f740549c535d0fb21228cd69e29fd59795bfcb6bf9de756d2` |
| `progressive-control-log.json` | `e5fe732358775e96a16b17d9ddcc25fa91a85d91be7256dff9b68ef97efc371d` |
| `request-log.json` | `13596798d5eeb1eb7b976f9490c3748c2315f02fb1b07bffa349f9318edf4dd2` |
| `server-stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `server-stdout.log` | `71f2a070d871631758dadd7183da63d29b92758f62d73c57b898947419ab0990` |
| `visual-theme-proof.json` | `edb7e346f16af1f3a01db8a7b9545b390016d3a242fc52c89c8587f63129015f` |

## Removed-artifact provenance — and the limit of this record

The removed files are **not** durably recoverable. They exist in this branch's
history today, but a squash merge or a branch deletion destroys them, so this
ledger must be read as the record of last resort rather than as an index into
something retrievable. That is the deliberate trade: the SHA-256 digests below
and in the review-history table prove *what was reviewed*, not *what it said*.

Anything whose content is genuinely load-bearing was therefore restored to
version control rather than left to history — the full live-QA evidence
directory, and every receipt cited by the approved spec or task texts.

## Citations in the spec and task files that now resolve here

The approved spec and task definitions cite receipt paths by name. Those texts
are the reviewed record and were deliberately **not** rewritten — editing them
would falsify what Sol actually approved. Instead, **every cited receipt that
ever existed in version control was restored**, so the citations resolve
against the tree rather than against a redirect table:

| Cited in | Restored path |
| --- | --- |
| spec (line 470) | `fn-112-task-6-transaction-receipt.md` |
| spec (line 1325), task `.4` | `fn-112-opus-plan-repair-task-4-design.md` |
| task `.1` | `fn-112-grok-task-1-repair-round3.json` |
| task `.2` | `fn-112-grok-task-2-repair-round2.{md,json}` |
| task `.3` | `fn-112-grok-implementation-task-3-repair.json` |
| task `.4` | `fn-112-grok-implementation-task-4-repair-round2.json` |
| task `.5` | `fn-112-grok-implementation-task-5-repair.{md,json}` |
| task `.6` | `fn-112-task-6-plan-repair-receipt.md`, `fn-112-task-6-plan-repair-receipt-round3.md`, `fn-112-opus-plan-repair-task-6-progressive-receipt.md` |

One citation cannot be repaired and was **already broken before this cleanup**:
task `.6`'s `claim_note` cites `fn-112-grok-task-6-repair-round-*`, which was
never tracked in git (those rounds only ever produced gitignored
`.events.jsonl` streams). It is recorded here rather than silently ignored.

The following were removed and are *not* cited by any approved text:

| Cited in | Removed path | Where its substance lives now |
| --- | --- | --- |
| Removed path | Why it is safe to drop |
| --- | --- |
| `fn-112-task-6-plan-repair-receipt-round2.{md,json}`, `fn-112-task-6-plan-repair-receipt{,-round3}.json` | Superseded plan-repair rounds not named by any approved text; the cited `.md` renderings are retained and the accepted outcome is in the spec's Decision Context |
| `fn-112-grok-*` (remaining rounds) | Superseded delegated-implementation rounds; the code they produced is the diff, and its acceptance is the per-task terminal SHIP |
| `fn-112-opus-plan-revision-*`, `fn-112-full-hermes-*`, `fn-112-durable-mission-state.json` | Orchestration transcripts and coordinator state, with session ids and no governance content |
| `*.result.json`, `fn-112-fable-revision.receipt.json`, `.flow/fable-spec-plan-receipt.json` | Harness telemetry: model, session id, token counts, USD cost |
| raw gate logs | Duplicated (`01–05` vs `final-01–05`) and regenerable; results live in `fn-112-task-7-gates/INDEX.md` |
| `fn-112-task-6-evidence/*` | Regenerable with `bun run test:e2e:pdf`; hashes and measurements are above |
