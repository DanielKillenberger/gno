---
satisfies: [R16, R17]
---
# fn-112-native-pdfjs-document-renderer.7 Documentation, CHANGELOG, and final quality gates

## Description
Finalization: documentation, CHANGELOG, and the full quality gate against the recorded baseline. One task per repo convention (docs + changelog + wiring together).

**Size:** S
**Files:** `docs/API.md`, `docs/WEB-UI.md`, `src/serve/CLAUDE.md`, `website/_data/features.yml`, `CHANGELOG.md`, `.flow/handoff/fn-112-gno-sh-docs-brief.md` (new, in-repo)

### Approach
- `docs/API.md`: add `GET /api/doc-asset` to the Read Operations quick-reference table (~line 63) and a new endpoint section following the strict existing pattern (`### Get Document` at ~line 1261: http block → Query Parameters table → Response → Example curl) — this endpoint was previously entirely undocumented; describe binary response headers + 200/206/416 semantics and the Range example. Document the three `/vendor/pdfjs/` asset routes briefly (served same-origin from the installed package).
- `docs/WEB-UI.md`: update `### Read-only Converted Documents` (~line 250) with the native PDF viewer + Pages/Text toggle + fallback behavior (including the four fallback reasons and the "No extracted text" sub-state); update the `## Security` CSP table (~lines 812-820) with `worker-src 'self'` and the same-origin pdfjs assets; note printing is unsupported (download original to print), that viewer state resets per visit, and that `globalThis.__gnoPdfMetrics` is an **unstable local diagnostic surface, not an API contract**.
- `src/serve/CLAUDE.md`: add `/api/doc-asset` and `/vendor/pdfjs/*` rows to the API Endpoints table (pre-existing omission); confirm the "No external font/script loading" security bullet stays true and mention the pdf worker.
- `website/_data/features.yml`: add a `web-ui` benefits bullet (short, capability-phrased, e.g. "Native PDF rendering with extracted-text fallback").
- `CHANGELOG.md`: `[Unreleased]` → `### Added` entry.
- Final gate: run the **five canonical baseline-compared commands (CBC)** verbatim, in order, exactly as task .2 captured them — `bun run lint:check`, `bunx tsc --noEmit`, `bun test`, `bun run test:web`, `bun run docs:verify` — and diff **each command's** failures against **that same command's** enumerated `failures[]` in the cited `captures[]` entry of the **durable baseline receipt** `.flow/reviews/fn-112-baseline-receipt.json` (not a remembered count, and not the scratch `/tmp/fn112-baseline/` logs, which may be gone by now). The command strings and the parsing must be identical to the capture's — no subset, no superset, no reformulation. Only failures that appear by name under the same command in the cited capture are tolerable; anything else is a new failure and blocks. Gates outside the CBC (`bun run test:e2e:pdf`, `bun run test:package`, the new tests, P-1…P-6) are **absolute-pass** and are never baseline-compared. The task summary and R17 evidence must **cite the receipt path and the exact `capture_id`** compared against, and list the tolerated pre-existing failures explicitly. If the receipt is missing or its log hashes no longer verify, regenerate the baseline first via the receipt's isolated-worktree path (`git worktree add --detach <tmpdir> bb994b580356a41a31093fea85b06993c1a18e4c`, verify `head_sha` and empty `git status --porcelain` **in that worktree**, `bun install --frozen-lockfile` in that worktree only, the same five CBC commands, `git worktree remove`), appending a new `regenerated: true` capture rather than editing the original — R17 is not satisfiable against an unverifiable baseline. **Regeneration here happens after tasks .1–.6, so this repository's planning worktree legitimately contains product, test, dependency, lockfile, and documentation changes.** That is expected and does **not** block regeneration: record `planning_worktree_state` truthfully (a summary or the `git status --porcelain` output), do **not** assert "no product-path changes" on a regenerated capture (that assertion belongs to the initial capture alone), and do not attempt to clean, stash, or revert the working tree to satisfy it. The regenerated baseline's provenance comes entirely from the isolated worktree — exact base `head_sha`, empty status there, frozen-lockfile setup with `bun.lock` unchanged, exact canonical command results, raw-log `sha256` hashes, and its unique `capture_id`.
- **Hosted-website documentation (owner-authorized scope expansion):** update the real
  `/Users/gordon/work/gno.sh` repository, run its full gates, and drive every changed
  page locally at desktop and mobile widths. Open a companion PR; do not claim or
  perform production deployment before that PR merges. Record the exact branch, PR,
  files, gates, and QA surfaces in `.flow/handoff/fn-112-gno-sh-docs-brief.md`.

### Investigation targets
**Required:**
- `docs/API.md:55-75, 1255-1320` — quick-reference table + endpoint section pattern
- `docs/WEB-UI.md:245-260, 730-825` — converted-docs section + security/CSP table
- `src/serve/CLAUDE.md:68-112` — endpoint table + security bullets

**Optional:**
- `website/_data/features.yml:90-135` — web-ui / multi-format benefit phrasing
- `scripts/docs-verify.ts` — behavioral harness (should be unaffected; verify)

### Acceptance
- [ ] All five in-repo doc surfaces updated per above; endpoint docs match the implemented contract exactly (headers, status codes, params, GET/HEAD)
- [ ] `docs/WEB-UI.md` records `__gnoPdfMetrics` as an unstable diagnostic surface, not an API contract
- [ ] CHANGELOG `[Unreleased]` entry added in Keep-a-Changelog format
- [ ] `bun run docs:verify` passes
- [ ] Full gate — the five canonical baseline-compared commands, verbatim and in order: `bun run lint:check`, `bunx tsc --noEmit`, `bun test`, `bun run test:web`, `bun run docs:verify` — each diffed per-command against the same command's enumerated failures in the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (task .2 step 0), compared against its enumerated pre-existing failure list; the summary cites the receipt path and the exact `capture_id` and enumerates the tolerated pre-existing failures
- [ ] `.flow/handoff/fn-112-gno-sh-docs-brief.md` records the executed hosted-site change, verification, browser QA, companion PR, and pending post-merge deployment
- [ ] `/Users/gordon/work/gno.sh` public docs, Web UI product claim, Browse showcase, and PDF FAQ match the shipped behavior; tests cover the public-truth boundary

## Acceptance
- [ ] API.md, WEB-UI.md, serve CLAUDE.md, features.yml, CHANGELOG updated to match the implemented contracts
- [ ] docs:verify passes
- [ ] Full suite + lint + typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (cited by `capture_id`, pre-existing ones enumerated)
- [ ] Hosted-site changes opened as a tested companion PR; local desktop/mobile QA evidence retained; production deployment explicitly pending merge


## Done summary
Documented the PDF viewer surface, added the CHANGELOG entry, and closed the final quality gates.

**Docs (all five in-repo surfaces, plus the AGENTS mirror):**
- `docs/API.md` — `GET /api/doc-asset` documented for the first time (it was previously entirely undocumented): quick-reference row, query params, binary response headers, and `200`/`206`/`400`/`403`/`404`/`416` semantics including the intentionally-unsupported multi-range case, with Range and `curl -I` examples. New `PDF.js Vendor Assets` section for the three `/vendor/pdfjs/*` routes.
- `docs/WEB-UI.md` — native viewer, Pages/Text toggle, the four fallback reasons and the "No extracted text" sub-state, full CSP directive table incl. `worker-src 'self'`, and the limits (no printing, per-visit viewer state). `__gnoPdfMetrics` recorded explicitly as an unstable diagnostic surface, **not** an API contract.
- `src/serve/CLAUDE.md` + `src/serve/AGENTS.md` — the two missing endpoint rows; the "no external font/script loading" bullet qualified with the same-origin pdfjs path.
- `CHANGELOG.md` `[Unreleased] / Added`; `website/_data/features.yml` web-ui benefit line.

**Defect found and fixed by this gate:** `src/serve/public/globals.built.css` was stale at `c9b828eb` and shipped **without** the PDF toolbar's zoom-select widths `min-w-[4.25rem]` and `min-w-[6rem]` (`PdfToolbar.tsx:257,266`). This file ships in the npm package. The rebuild adds those two and drops five utilities verified unused by any source; the generated `mark` rule is byte-identical, so no visual regression.

**R17 baseline comparison.** Receipt `.flow/reviews/fn-112-baseline-receipt.json`,
`capture_id` **`cap-002`** (`regenerated: true`, base `bb994b58`). The original
`cap-001` scratch logs were absent, so the baseline was regenerated in a clean
detached worktree at the exact base with a frozen-lockfile install. All five new
`raw_log_sha256` values re-hash correctly. **Tolerated pre-existing failures:
NONE** — `cap-002` enumerates `failures: []` for every command, so the tolerance
set is empty and all five current commands had to pass absolutely. They did:
`bun run lint:check` 0/0, `bunx tsc --noEmit` exit 0, `bun test` exit 0,
`bun run test:web` 305 pass / 0 fail, `bun run docs:verify` 15 passed / 0 failed /
2 skipped. Zero new failures.

**Absolute-pass gates:** `test:e2e:pdf` PASSED, `test:package` passed, `build:css` 0, `flowctl validate --spec` Valid: True, `git diff --check` 0. `bun run build` fails on an unrelated `markitdown-ts` → `youtube-transcript` import; proven pre-existing by reproducing it in a detached worktree at base `bb994b58` with empty status and a frozen-lockfile install. It is not one of the five CBC commands.

`test:package` failed twice before passing, both environmental and both diagnosed rather than masked: (1) the real-GNO isolation sentinel correctly tripped because a user-owned resident `gno serve` watcher reindexed the docs edited here — the user's service was not killed, the run was repeated after quiescence; (2) `/tmp` exhausted (EDQUOT) by this task's own two forensic dumps, which were the only `gno-package-smoke-*` dirs and the only thing removed. The task `.7` gate index that held the full forensic detail was removed during PR hygiene; the account above is the surviving record, and `.flow/reviews/fn-112-landing-record.md` records only the final passing gate run.

**Reviews:** independent Sol (`gpt-5.6-sol`) task review → **SHIP** at round 4 (closed: guessed gno.sh paths, targets requiring editorial judgment, undefined deletion boundary). Sol spec-completion review across R1–R19 → **SHIP**. Integrated live QA drove a real isolated `gno serve` with Playwright: **8/8 scenarios PASS, 0 findings**; QA-1 and QA-6 screenshots inspected directly, not trusted from the exit code.

**Hosted site:** `/Users/gordon/work/gno.sh` was updated and opened as
[`gmickel/gno.sh#26`](https://github.com/gmickel/gno.sh/pull/26) from
`codex/native-pdf-viewer-docs`. The public Web UI/API docs, Web UI product page,
Browse showcase, and PDF FAQ now match the native viewer while preserving the
read-only binary boundary. `bun run check`, `bun run typecheck`, `bun run build`,
and `bun test` passed; local desktop/mobile browser QA covered every changed page
with no console errors. Production deployment remains pending PR merge and is not
claimed here. The execution record is `.flow/handoff/fn-112-gno-sh-docs-brief.md`.
## Evidence
- Commits: b54a8f3558907c5b6294cd99417814210fbedb14
- Tests: bun run lint:check, bunx tsc --noEmit, bun test, bun run test:web, bun run docs:verify, bun run test:e2e:pdf, bun run test:package, bun run build:css, .flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer
- PRs:
