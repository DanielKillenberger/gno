# fn-112 task .6 — transaction receipt (round 6, repair-complete)

**Status: REPAIR-COMPLETE — awaiting fresh independent Sol round-7 review.** Both round-6 blockers in `.flow/reviews/fn-112-sol-impl-rereview-task-6-round6.json` are closed. Sol round 6 confirmed the four earliest findings RESOLVED but kept SOL6-R5-IMPL-01/02 OPEN pending these two repairs, which are now done. Flow task `.6` remains `in_progress`/unaccepted — acceptance is Sol's verdict, never self-granted.

**This receipt supersedes its round-2 through round-5 wording.** In particular the round-4 "secret hygiene" claim was **wrong** and is corrected below. Every gate reference points at a durable in-repo artifact under `.flow/reviews/fn-112-task-6-gates/`.

- **Ownership:** sole implementation/repair owner for task `.6`.
- **Canonical model:** `claude-opus-5`, effort **medium**. Session `5ff94573-c8ee-4297-96d9-f8d27360de84`.
- No subagents, no other model, no commit, push, PR, merge, and no work on task `.7`.
- Base/HEAD `bb994b580356a41a31093fea85b06993c1a18e4c`, branch `feat/native-pdf-renderer`; all fn-112 work remains uncommitted.

## Findings status

| Finding | Status |
| --- | --- |
| SOL6-R3-IMPL-01 (atomic reset boundary) | RESOLVED (confirmed by Sol, rounds 4 and 5) |
| SOL6-R3-IMPL-02 (metric ownership + negative control) | RESOLVED (confirmed by Sol, round 5) |
| SOL6-R4-IMPL-01 (durable negative control) | RESOLVED (confirmed by Sol, round 5) |
| SOL6-R4-IMPL-02 (durable gate/package evidence) | RESOLVED (confirmed by Sol, round 5) |
| SOL6-R5-IMPL-01 (light theme never captured) | theme fix confirmed; held open by Sol round 6 for blank light-rail canvases — **now closed** |
| SOL6-R5-IMPL-02 (credential-derived metadata) | verifier purge confirmed; held open by Sol round 6 for the residual filename — **now closed** |
| **SOL6-R6-IMPL-01** (light rail captures blank) | **CLOSED this round** |
| **SOL6-R6-IMPL-02** (concrete sensitive filename still present) | **CLOSED this round** |

## SOL6-R6-IMPL-01 — CLOSED · rail captures now prove the fixture is rendered under each theme

**Sol's finding.** Direct visual inspection found both light rail captures carried blank PDF canvases. The harness checked non-blank only *before* applying `data-theme`, so a theme-induced relayout/rerender could blank the canvas with nothing to catch it. The theme fix from round 5 was real, but the captures it produced were not usable evidence.

**Repair.** After each theme is applied **and settled**, and immediately **before** the rail capture, the harness now:

1. re-establishes the render with a bounded `waitForNonBlankCanvas(page, 20_000)` — this runs *after* the theme, which is precisely what the earlier ordering could not witness; and
2. asserts the capture's own subject is present: at least one `data-rendered="true"` canvas **and** the fixture's known glyph run in the text layer.

This runs for **both themes at both widths**, and a blank rerender now fails the run rather than shipping. Recorded per cell in `visual-theme-proof.json` as `themeRailSubjects`:

| Cell | renderedCanvases | hasKnownGlyphRun | textLength |
| --- | --- | --- | --- |
| dark-w1380 | 3 | true | 490 |
| dark-w900 | 3 | true | 490 |
| light-w1380 | 3 | true | 490 |
| light-w900 | 3 | true | 490 |

**All eight PNGs were then inspected directly.** Every rail capture — including both light ones — shows the rendered fixture page ("Viewer Link Fixture - Page 1", "KNOWN_GLYPH_RUN_ALPHA the quick brown fox") in its correct palette; the two w900 overview clips show the Overview card; the two w1380 overview clips show the properties rail. All **8** hashes remain distinct, and the round-5 theme, pair-hash and overview-subject assertions are preserved unchanged.

## SOL6-R6-IMPL-02 — CLOSED · the concrete filename is gone everywhere

**Sol's finding.** The concrete sensitive config filename still appeared in the durable INDEX, in both transaction receipts, and in a source comment.

**Repair.** Every occurrence across source comments, review artifacts, prompts, transcripts, receipts and the index was replaced with the generic phrase *credential-bearing config file*, preserving Sol's finding semantics without the concrete name. Verification uses runtime-constructed patterns so the check itself cannot reintroduce either value into a durable transcript, and prints counts only:

```
files scanned: 3466
sensitive_filename: 0 occurrence(s) in 0 file(s)
prior_verifier:     0 occurrence(s) in 0 file(s)
```

The aggregate config equality output and the complete in-memory snapshot assertion are unchanged: `assertUserGnoStateUnchanged` still compares full snapshots including hashes, and the durable log still reports `root <config-root> … unchanged=true` plus `Real GNO sentinel passed: 6 files / 155612828 bytes …`.

## SOL6-R5-IMPL-02 — CLOSED · credential-derived metadata removed, and the leak purged repo-wide

**Sol's finding.** The round-4 diagnostics serialized durable per-file hashes and metadata for real user configuration — including a credential-bearing config file with its absolute home path, size, mode and mtime. A credential hash is a persistent verifier derived from secret contents; it is unnecessary for proving unchanged state and contradicted this artifact's own hygiene claim.

**This was a genuine regression I introduced, and my round-4 hygiene claim was wrong.** I had reasoned that "a hash is not the value"; that reasoning was incorrect for a credential file.

**Repair, in order.**

1. The leaking `gate-package.log` was deleted **before any other work**.
2. `formatUserGnoSentinelDetail` was replaced by `formatUserGnoSentinelSafeDetail(before, after)`. Durable output now emits **no absolute paths, no content-derived hashes, and nothing whatsoever about config-root files**. The credential-bearing root prints only existence, before/after count, before/after byte total and the equality result, with an explicit redaction line. The data root keeps product-generated index filenames and sizes as the permitted non-sensitive stat evidence.
3. **The in-memory assertion is unchanged**: `assertUserGnoStateUnchanged` still compares the complete snapshots, hashes included. Only what is *written durably* was narrowed.
4. The leaked verifier was purged repo-wide. It also survived in three owner/reviewer `.events.jsonl` transcripts; those now carry `<redacted-credential-hash-SOL6-R5-IMPL-02>` in its place and still parse (55 / 23 / 75 lines). A repo-wide search for the hash now returns **zero** occurrences. Nothing was ever committed, so there is no git-history exposure.
5. Absolute home paths were additionally replaced with `<home>` across the durable gate logs — ordinary test-runner output embeds workspace paths that carry no secret but need not ship in a review artifact.

Regenerated privacy-safe sentinel output, verbatim from `gate-package.log`:

```
[gno-sentinel] privacy-safe before/after summary
[gno-sentinel]   (absolute paths, content hashes, and all config-root file
[gno-sentinel]    names/sizes/modes/mtimes are intentionally NOT recorded)
[gno-sentinel]   root <config-root> exists=true count(before/after)=3/3 bytes(before/after)=1684/1684 unchanged=true
[gno-sentinel]     <config root contents redacted — credential-bearing; equality proven by the full-snapshot assertion above>
[gno-sentinel]   root <data-root> exists=true count(before/after)=3/3 bytes(before/after)=155611144/155611144 unchanged=true
[gno-sentinel]     index-default.sqlite size(before/after)=147144704/147144704
[gno-sentinel]     index-default.sqlite-shm size(before/after)=32768/32768
[gno-sentinel]     index-default.sqlite-wal size(before/after)=8433672/8433672
Real GNO sentinel passed: 6 files / 155612828 bytes SHA-256/stat/count unchanged
```

The installed-asset proof is fully retained (ephemeral `/tmp` install paths and package-internal hashes only — no user data):

| Asset | Installed file | GET | HEAD |
| --- | --- | --- | --- |
| `/vendor/pdfjs/pdf.worker.min.mjs` | 1 232 303 B · `52fadd5b…82619` | 200 · 1 232 303 B · same hash · **MATCH** | 200 · body 0 B · headers MATCH |
| `/vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap` | 25 439 B · `ad2352f4…4da0b` | 200 · 25 439 B · same hash · **MATCH** | 200 · body 0 B · headers MATCH |
| `/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf` | 139 512 B · `f8ace1f8…8221f` | 200 · 139 512 B · same hash · **MATCH** | 200 · body 0 B · headers MATCH |

Launch is recorded directly: installed binary path, package root, resolved installed `pdfjs-dist`, `launched installed 'gno serve' pid=… port=… (NOT repo bun source)`, then `installed binary healthy at …`.

## SOL6-R5-IMPL-01 — CLOSED · light theme is genuinely captured, and a second capture defect was found and fixed

**Sol's finding.** `data-theme` was set before `openPdf`, which navigates and clears the DOM-only attribute, so every "light" screenshot was byte-identical to its dark counterpart. The evidence supplied two copies of the dark state, leaving the eight-way visual acceptance unmet despite a green gate.

**Repair.** The theme is now applied **after** navigation through the mechanism the stylesheet keys on (`[data-theme]` on the document element), then awaited with bounded `requestAnimationFrame` polling until the computed custom properties settle — no fixed sleeps. Recorded in the new `.flow/reviews/fn-112-task-6-evidence/visual-theme-proof.json`:

| Theme | `--background` | body background | `--foreground` | body color |
| --- | --- | --- | --- | --- |
| dark (w1380 and w900) | `0 0% 2%` | `rgb(5, 5, 5)` | `0 0% 93%` | `rgb(237, 237, 237)` |
| light (w1380 and w900) | `40 33% 98%` | `rgb(252, 250, 248)` | `30 9% 13%` | `rgb(36, 33, 30)` |

**Second defect, found while verifying the first.** The `-overview` captures did not depict their subject: nothing scrolled, so they were a second full-page shot of the same viewport — byte-identical to `-rail` at dark/w900 — and at 1380 the overview card is `lg:hidden` and legitimately absent. This is the same class of misleading evidence, on a different axis. The subject is now scrolled into view, **asserted on-screen**, and captured **clipped to its own bounding box**: the mobile overview card below `lg`, the properties rail at `lg`. Clipped captures are ~16 KB versus ~128 KB full-page, and the dark/light overview PNGs were visually confirmed to show the Overview card in the correct palette.

**Non-vacuity assertions now enforced** (no fragile pixel sampling):

1. the applied `data-theme` must survive navigation, else the run fails;
2. computed dark vs light values must differ at each width;
3. every paired dark/light screenshot must differ by sha256;
4. the clip subject must be found and on-screen at capture time.

All **8** screenshot hashes are now distinct (previously 4 distinct, then 7). Per-cell subject proof: `visual_dark_1380` / `visual_light_1380` → `properties-rail`, `visual_dark_900` / `visual_light_900` → `mobile-overview-card`, all `found: true, inViewport: true`.

## P-4b atomic reset boundary (SOL6-R3-IMPL-01, still green on the regenerated run)

| Field | Run A | Run B |
| --- | --- | --- |
| quiescenceSeq / **resetBoundarySeq** | 45 / **45** | 36 / **36** |
| postResetSeqHigh | **0** | **0** |
| entry gen @ scale | 3 @ 1 | 3 @ 1 |

## Gates (all durable under `.flow/reviews/fn-112-task-6-gates/`)

| Command | Exit | Result | Artifact |
| --- | --- | --- | --- |
| guard-only negative control | **1** (expected) | intended assertion failed; restored + positive rerun passed | `negative-control.log` |
| `bun test …use-pdf-pages.dom.test.tsx` | **0** | 14 pass, 0 fail | `gate-use-pdf-pages.log` |
| `bun test test/serve/public/lib/pdf.test.ts` | **0** | 23 pass, 0 fail | `gate-lib-pdf.log` |
| `bun test test/serve/public/components/pdf` | **0** | 44 pass, 0 fail | `gate-components-pdf.log` |
| `bun test test/scripts/` | **0** | 33 pass, 0 fail (covers the modified sentinel module) | `gate-scripts.log` |
| `bun run test:web` | **0** | 295 pass, 0 fail, 1524 assertions, 39 files | `gate-test-web.log` |
| `bun test` (full suite) | **0** | **3595 pass, 2 skip, 0 fail**, 28 590 assertions, 3597 tests, 439 files, 163.70 s | `gate-full-bun-test.log` |
| `bun run test:e2e:pdf` | **0** | `PDF viewer smoke PASSED` | `gate-e2e.log` |
| `bun run test:package` | **0** | installed-binary GET/HEAD byte equality + privacy-safe sentinel | `gate-package.log` |
| `bun run typecheck` | **0** | clean | `gate-typecheck.log` |
| `bun run lint:check` | **0** | 0 warnings, 0 errors | `gate-lint.log` |
| `git diff --check` | **0** | clean | — |
| `flowctl validate --spec fn-112…` | **0** | `valid: true`, 0 errors | — |

Every gate above was re-run against the current source after this round's changes to `scripts/pdf-viewer-smoke.ts` and `scripts/package-smoke-user-sentinel.ts`; nothing is carried over from an earlier source state.

## Measured budgets (regenerated run, read from the artifacts)

| Budget | Measured | Threshold | Verdict |
| --- | --- | --- | --- |
| P-1 small / large | **388.4 ms** / **2087.9 ms** | ≤ 1500 / ≤ 3000 | pass |
| P-2 live canvases | max **3** | ≤ 10 | pass |
| P-3 renderStart | **6**; orphans 0, doubles 0, dropped 0; `finalWindowRendered` **3** | ≤ 60 | pass |
| P-4a | 20 samples, ascending 19th = **52.0 ms** | ≤ 500 | pass |
| P-4b | runs A + B, ordered cancel → cancelled-settle → replacement start | ≥ 2 runs + ordering | pass |
| P-5 | backing dims within `min(dpr,2) × zoom` and the area cap | caps respected | pass |
| P-6 | `destroySeq 7`, **lateStarts 0**, dropped 0 | 0 late starts | pass |

`failures: []`, `budgetFailures: []`, `nonSelfRequests: []` (0), `jsActionDialog: false`, `standardFontCanvasInk: true`, `cjkCanvasInk: true`, 22 screenshots, all seven R8 states. No threshold relaxed.

## Files changed this round (round 6)

- `scripts/pdf-viewer-smoke.ts` — post-theme `waitForNonBlankCanvas` plus a rail-subject assertion (rendered canvas + fixture glyph run) before every rail capture; `themeRailSubjects` recorded in `visual-theme-proof.json`. Round-5 theme/pair-hash/overview-clip assertions preserved.
- `scripts/package-smoke-user-sentinel.ts` — comment now refers to the credential-bearing config file generically.
- `.flow/reviews/**` — concrete filename replaced by the generic phrase across INDEX, receipts, prompts and transcripts; gate artifacts regenerated.
- `src/serve/public/hooks/use-pdf-pages.ts` — **unchanged**; sha256 `3212eb7f…e038f30`, identity guard present.
- No production source changed this round.

## Integrity

No threshold, oracle, or contract was weakened. This round strengthened the visual acceptance (from screenshots that could not fail, to four enforced assertions) and removed a privacy regression without weakening the isolation assertion behind it. The production metrics schema is unchanged, and no production source changed this round. Task `.6` stays `in_progress`; task `.7` untouched; nothing committed, pushed, or opened as a PR.

## Remaining work

None from this owner. Awaiting fresh independent Sol round-7 review.
