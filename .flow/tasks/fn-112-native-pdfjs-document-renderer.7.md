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
Completed the native PDF viewer documentation and final quality gates. Corrected the fallback contract in CHANGELOG and Web UI docs, retained real hosted-site browser evidence, and implemented the public documentation in gmickel/gno.sh#26. The companion site passed check, typecheck, build, all tests, and desktop/mobile browser QA. The five GNO canonical commands passed with zero new failures against regenerated durable baseline capture cap-002; cap-002 has no tolerated pre-existing failures and its raw-log hashes were verified. Absolute PDF E2E and package-install smokes also pass. Production gno.sh deployment remains pending companion PR merge and is not claimed.
## Evidence
- Commits: 936d9c3bf490f10885921b46c4fc692def26552d, d5894f9b, gmickel/gno.sh@192dead
- Tests: bun run lint:check, bunx tsc --noEmit, bun test, bun run test:web, bun run docs:verify, bun run test:e2e:pdf, bun run test:package, bun run build:css, .flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer, gno.sh: bun run check, gno.sh: bun run typecheck, gno.sh: bun run build, gno.sh: bun test, gno.sh: local desktop/mobile browser QA
- PRs: https://github.com/gmickel/gno/pull/161, https://github.com/gmickel/gno.sh/pull/26