# fn-112 landing record

Consolidated evidence + review ledger for spec `fn-112-native-pdfjs-document-renderer`.

This is the single durable Flow artifact for the PR, alongside the terminal
spec-completion verdict in `fn-112-spec-completion-sol-round1.out.md`. Every
other build artifact — per-round review receipts, orchestration transcripts,
harness telemetry, raw gate logs, screenshots, driver scripts, and the
regenerable browser evidence — was removed during PR hygiene. Repository
precedent for merged feature PRs (#147, #151, #152, #154, #156) retains **zero**
`.flow/reviews` files; this record and the completion verdict are the deliberate
two-file exception, kept because they are the only proof that R1–R19 were
independently accepted and that the gates ran.

The evidence summary and the review ledger are one document on purpose:
separating them would duplicate the gate table and the artifact-hash table
across two files for no reader benefit.

## Acceptance chain

| Stage | Outcome | Where |
| --- | --- | --- |
| Plan review | SHIP (round 6; rounds 1–5 REVISE) | ledger below |
| Per-task implementation review, tasks `.1`–`.7` | SHIP each (terminal round) | ledger below |
| Spec completion review, R1–R19 | **SHIP** | `fn-112-spec-completion-sol-round1.out.md` (retained verbatim) |
| Live QA | SHIP, 8/8 PASS, 0 findings | this file |
| PR hygiene review | SHIP | ledger below |

Reviewer for every row: Sol, canonical model `gpt-5.6-sol`, read-only mode.

## Durable baseline — capture `cap-001`

Captured before any implementation in an isolated detached worktree at base
`bb994b580356a41a31093fea85b06993c1a18e4c` (empty `git status --porcelain`
there, `bun install --frozen-lockfile` exit 0, `bun.lock` unchanged).
This is the R17 baseline: the five canonical baseline-compared commands and
their enumerated failures, against which the final gate run was diffed.

| Command | Exit | Counts | Enumerated failures | Log SHA256 |
| --- | ---: | --- | --- | --- |
| `bun run lint:check` | 0 | fail:0 | *(none)* | `ca9866857ce9e65b4e40630162095ab26eb0fbb5bde76da75c5e5169952e5bc4` |
| `bunx tsc --noEmit` | 0 | fail:0 | *(none)* | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `bun test` | 0 | 3463 pass / 0 fail / 2 skip | *(none)* | `6388cbbd315c5ac3f0ce434321d68872b20e4199048c705262394b153753ae47` |
| `bun run test:web` | 0 | 186 pass / 0 fail | *(none)* | `098bdde9f4800f478e22cc5d0f0e2fdff1a2e5f5670f813e55fbefd7a6615283` |
| `bun run docs:verify` | 0 | 15 pass / 0 fail / 2 skip | *(none)* | `252b59167a56c549a7c59a6c3d3d5f469e37dc10cb99e591ac5f7a662c1acc6d` |

**Tolerated pre-existing failures: none.** All five commands exited 0 at base,
so every failure in the final run would have been a new failure.

## Final gate run

| Gate | Result |
| --- | --- |
| `bun run lint:check` | pass — 0 warnings, 0 errors, format clean |
| `bunx tsc --noEmit` | pass — exit 0 |
| `bun test` | 3,595 pass / 2 skip / 0 fail |
| `bun run test:web` | 295 pass / 0 fail |
| `bun run docs:verify` | 15 passed / 0 failed / 2 skipped |
| `bun run test:e2e:pdf` | pass — PDF viewer smoke, P-1…P-6 within budget |
| `bun run test:package` | pass — installed-binary pdfjs GET/HEAD byte equality + privacy-safe sentinel |
| `bun run build:css` | pass |
| `flowctl validate --spec fn-112-native-pdfjs-document-renderer` | Valid, 7/7 tasks |

**Known pre-existing, unrelated failure:** `bun run build` fails. Proven
pre-existing, not assumed: an isolated detached worktree at base
`bb994b58` (clean status, `bun install --frozen-lockfile` exit 0) reproduces
the identical failure. The script runs `bun build src/index.ts` with no target,
so it resolves as a *browser* build and rejects Node/Bun builtins pulled in
transitively (`node:module` via `node-llama-cpp`, `bun:sqlite`, `child_process`
via `simple-git` / `cross-spawn` / `markitdown-ts`), finally failing to resolve
`youtube-transcript`. `build` is not in `prerelease` (`lint:check` + `test`) and
is not on the publish path, which uses `build:css`.

## Live QA — 8/8 PASS, 0 findings, verdict SHIP

Driven with Playwright/Chromium (headless, 1380×880) against a real `gno serve`
on an isolated temp GNO config/data/cache and a temp collection; the user's real
state and `:3000` server were untouched.

| Scenario | R-IDs | Outcome | Observed |
| --- | --- | --- | --- |
| QA-1 PDF opens in Pages, canvas + selectable text layer, no iframe/object/embed | R1, R2, R6 | PASS | `renderedCanvases=3 textLayerChars=218 iframe/object/embed=0` |
| QA-2 Pages/Text toggle switches both ways | R9 | PASS | Text: `canvases=0 pre=1`; back to Pages `rendered=true` |
| QA-3 Page navigation advances the page | R4 | PASS | page 1 → 2 |
| QA-5 Keyboard `+` zooms, `0` resets to 100% | R5 | PASS | `scaleAfterReset=metrics-unavailable(visual check)` |
| QA-6 Corrupt PDF shows a designed failure state naming the reason | R8, R9 | PASS | `viewerErrorPanel=1 cannotRenderCopy=true downloadActions=3 fallbackNotice=0` |
| QA-8 Download original resolves over `/api/doc-asset` | R9, R11 | PASS | `HEAD 200 accept-ranges=bytes type=application/pdf` |
| QA-9 Non-PDF markdown document unaffected | R19 | PASS | `pdfCanvases=0 contentVisible=true` |
| QA-10 All viewer traffic same-origin; assets from `/vendor/pdfjs` | R2, R3 | PASS | `foreignRequests=0 vendorPdfjsRequests=2` |

QA-5's recorded scalar is a visual check, so its screenshot was its evidence;
the screenshot is not retained (precedent retains no binary QA artifacts) and
the observation above is the surviving record. The QA scenarios are re-drivable
from the spec's AC / R-IDs.

## Measured performance (task `.6` browser evidence)

linux/x64, Bun 1.3.14, headless Chromium, 2026-08-01. Source `evidence.json`
(sha256 `319e00bb6f09198c75cbfc00938b1fa10f5a50ea0e7e2d34abdf358b40e5b7d8`) is
not retained — regenerate with `bun run test:e2e:pdf`.

| Budget | Bounds | Result |
| --- | --- | --- |
| P-1 | First page paint | 388.4 ms small / 2087.9 ms large |
| P-2 | Live canvases during traversal | 3, 0, 2, 0, 2 — bounded |
| P-3 | Render starts, 200-page traversal | 6 starts, 6 settles, 0 orphans / doubles / dropped |
| P-4a | Zoom 100% → 200% | n=20, median 47.5 ms, p95 52.0 ms, max 67.1 ms |
| P-4b | Superseded-render cancellation | 2 runs (210%, fit-page); cancel → replacement ordering held |
| P-5 | Canvas resolution caps | effective DPR 1 (max 2); largest start 1,938,816 px vs 16,777,216 px cap |
| P-6 | Document teardown | destroy seq 7, 0 late starts, 0 dropped |

`budgetFailures: []`, `failures: []`. Behavioral results from the same run:
`nonSelfRequests: 0`, `jsActionDialog: false` (embedded PDF JavaScript inert),
text-layer alignment within 6 px at 100% / fit-width / 200%, and all seven
designed states observed (`loading`, `progressive`, `empty`, `corrupt`,
`password`, `network`, `bootstrap`). Observed `/api/doc-asset` headers: `200`,
`accept-ranges: bytes`, `cache-control: no-store`,
`content-disposition: inline; filename*=UTF-8''…`, plus the full security
envelope with `worker-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.

**Negative control:** `OVERALL=PASS` — with the guard mutated the targeted
assertion fails (exit 1); after byte-identical restoration it passes (exit 0),
proving the task `.6` assertions are non-vacuous.

## Review ledger — every round

Terminal verdict per scope was SHIP. Intermediate rounds are recorded by
verdict and content digest; the receipt files themselves are not retained.

| Scope | Rounds | Terminal |
| --- | --- | --- |
| Plan review | 6 (1–5 REVISE) | SHIP |
| Targeted plan repairs (task `.4` progressive, task `.6` performance + progressive) | 7 | SHIP each |
| Task `.1` implementation | 4 | SHIP |
| Task `.2` implementation | 3 | SHIP |
| Task `.3` implementation | 5 | SHIP |
| Task `.4` implementation | 3 | SHIP |
| Task `.5` implementation | 2 | SHIP |
| Task `.6` implementation | 7 | SHIP |
| Task `.7` implementation | 4 | SHIP |
| Spec completion, R1–R19 | 1 | **SHIP** (retained verbatim) |
| PR hygiene + implementation integrity | 2 | SHIP |

Across all recorded Sol receipt files: 3 SHIP, 19 NEEDS_WORK, 9 REVISE — the
build converged through 31 recorded independent review rounds.

## Provenance limits — read this before trusting the record

The removed receipts are **not** durably recoverable: they exist in this
branch's history now, but a squash merge or branch deletion destroys them. This
record is therefore the record of last resort. Its digests prove *what was
reviewed*, not *what the reviews said*. Anything whose content is genuinely
load-bearing — the R1–R19 dispositions — is retained verbatim in the completion
verdict rather than summarized here.

Spec and task texts cite receipt paths from the build. Those citations were
repointed to this record; the surrounding requirement text, acceptance criteria,
R-ID meanings, and done summaries were **not** altered. One citation predates
all cleanup and was never resolvable: task `.6`'s `claim_note` names
`fn-112-grok-task-6-repair-round-*`, which was never tracked in git (those
rounds produced only gitignored `.events.jsonl` streams).
