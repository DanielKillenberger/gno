---
satisfies: [R2, R3, R11, R12, R17]
---
# fn-112-native-pdfjs-document-renderer.1 Harden doc-asset with Range support and add same-origin pdfjs asset routes plus CSP worker-src

## Description
Server foundation for the PDF renderer: extend `GET /api/doc-asset` with single-range HTTP Range support and symlink-escape hardening, add the three same-origin `/vendor/pdfjs/` asset routes (worker, cMaps, standard fonts) served from the installed `pdfjs-dist` package, and add `worker-src 'self'` to the CSP. Runs AFTER task .2 (`depends_on`): the clean-upstream baseline is already recorded and `pdfjs-dist` is already pinned in `package.json`/`bun.lock` — no local installs, no coordination hand-offs.

**Size:** M
**Files:** `src/serve/routes/api.ts`, `src/serve/server.ts`, `test/serve/api-doc-assets.test.ts`, `test/serve/security.test.ts`

### Approach
- Baseline note: the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (created by task .2 step 0; raw logs at `/tmp/fn112-baseline/` are scratch) is the comparison target for this task's gates — compare against its enumerated pre-existing failure list and cite the `capture_id` used. Do not re-record the baseline here; if the receipt is missing or unverifiable, task .2 regenerates it via the isolated worktree path rather than this task inventing a new one.
- `isPathWithinRoot` (`src/serve/routes/api.ts:691-701`): keep the lexical check, then add realpath containment — canonicalize BOTH the configured root AND the candidate before the containment comparison. Error policy: only ENOENT on the candidate falls back to the lexical verdict (genuinely-missing file); every other realpath error (EACCES, ELOOP, …) fails closed (rejected). The validated spike diff in `/tmp/gno-native-pdf-investigation` (uncommitted `git diff HEAD -- src/serve/routes/api.ts src/serve/server.ts`) is reference evidence for this and the Range logic — read it, do not copy blindly, and do NOT take its iframe/CSP-frame changes.
- `handleDocAsset` (`api.ts:2064-2148`): add `request?: Request` param (pass it from both call sites: `server.ts:753-763` route and the `api.ts:5260` dispatcher); emit `Accept-Ranges: bytes` + `Content-Disposition: inline; filename*=UTF-8''<encoded>` always; parse single-range `Range` per RFC 9110 → `206` with `Content-Range`/`Content-Length` and body via `file.slice(start, end+1)`; malformed/unsatisfiable → `416` + `Content-Range: bytes */total`; multi-range → strict `416` + `Content-Range: bytes */total` (document this choice in a test name).
- New routes in the `Bun.serve({routes})` map (`server.ts:273-291`, follow the plain `/api/health` non-resident style, wrapped in `withSecurityHeaders`): `/vendor/pdfjs/pdf.worker.min.mjs` (Content-Type `text/javascript`), `/vendor/pdfjs/cmaps/:file`, `/vendor/pdfjs/standard_fonts/:file`. Resolve base paths via `import.meta.resolve("pdfjs-dist/build/pdf.worker.min.mjs")` etc. (`pdfjs-dist` is already pinned by task .2). `:file` must be one path segment, no `..`/`/`, and the resolved path containment-checked against the package dir; unknown → standard 404 error envelope, never a crash. GET/HEAD only — HEAD returns the same headers with empty body; resolve lazily per-request so a broken install degrades to 404, never a startup crash (tested by stubbing the resolver, not by uninstalling).
- CSP: add `worker-src 'self'` to `getCspHeader` (`server.ts:138-159`). Do NOT touch `frame-ancestors`, `X-Frame-Options`, `object-src`. Add a direct security-test assertion that no CSP directive contains `unsafe-eval` (do not rely solely on the task-.6 JS-action browser fixture for the eval posture).

### Investigation targets
**Required** (read before coding):
- `src/serve/routes/api.ts:685-701, 2058-2148` — path checks + current handler
- `src/serve/server.ts:134-177, 273-291, 750-765` — CSP builder, security headers, route map, doc-asset call site
- `test/serve/api-doc-assets.test.ts` — existing unit-test harness to extend
- `/tmp/gno-native-pdf-investigation` spike diff (`git diff HEAD` there) — validated Range/realpath reference (read-only)

**Optional:**
- `test/serve/security.test.ts` — CSP/header assertion patterns

### Key context
- pdfjs range streaming only activates when the server sends `Accept-Ranges: bytes` and honors `Range` — this task is a prerequisite for large-doc behavior, not an optimization.
- `Bun.file(path)` conforms to the Blob interface; byte slicing is standard `Blob.slice(start, end)` (MDN semantics).
- Existing `MarkdownPreview` images load through `/api/doc-asset`; browsers may send speculative `Range: bytes=0-` for `<img>` — cover with a regression test (206 with full-length slice is acceptable and correct).
- Keep `Cache-Control: no-store` (spec Decision Context).
- **Reconciled 2026-08-01 (Sol PR6-02, documentation only):** the multi-range wording above previously said "treat as full-body 200". That was stale — the accepted implementation and tests return strict `416` + `Content-Range: bytes */total` (`src/serve/routes/api.ts:2163`, `:2254-2267`, finding I1-03), and the spec's API contract table already states 416. Only these two statements were corrected; the single-range, full-GET, and HEAD contracts are unchanged, and task .1 stays `done` with its existing receipt (`.flow/reviews/fn-112-grok-task-1-repair-round3.json`, Sol round-4 re-review `.flow/reviews/fn-112-sol-impl-rereview-task-1-round4.json`). No implementation or test was reopened.

### Acceptance
- [ ] `handleDocAsset`: 200 keeps prior behavior + new `Accept-Ranges`/`Content-Disposition`; `bytes=a-b`, `bytes=a-`, `bytes=-n` → correct 206 slices; malformed/unsatisfiable → 416 with `Content-Range: bytes */total`; multi-range → strict 416 with `Content-Range: bytes */total` (unit tests for each)
- [ ] Symlink pointing outside a collection root is rejected (403) with a new unit test (root AND candidate canonicalized); non-ENOENT realpath errors fail closed (unit test); existing traversal + image-serving tests still pass
- [ ] `Range: bytes=0-` image regression test passes (MarkdownPreview consumer path)
- [ ] `/vendor/pdfjs/` worker/cmap/standard-font routes serve correct bytes + Content-Type on GET; HEAD returns matching headers with empty body (tests per route); invalid `:file` (traversal, multi-segment, unknown) → 404 envelope; missing/broken package resolves to 404 per-request, never a startup crash (tests)
- [ ] CSP header contains `worker-src 'self'`, contains NO `unsafe-eval` anywhere, AND still contains `frame-ancestors 'none'`, `object-src 'none'`; `X-Frame-Options: DENY` intact — asserted in `test/serve/security.test.ts` incl. on a doc-asset response
- [ ] `bun test test/serve/api-doc-assets.test.ts test/serve/security.test.ts` green; `bun run lint:check` + `bunx tsc --noEmit` show no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (task .2 step 0)

## Acceptance
- [ ] Range (206/416/suffix), Content-Disposition, Accept-Ranges unit-tested on handleDocAsset
- [ ] Realpath symlink-escape rejection unit-tested (root+candidate canonicalized; only candidate-ENOENT falls back lexically, other errors fail closed); existing doc-asset tests green
- [ ] /vendor/pdfjs/ worker + cmaps + standard_fonts routes serve from the .2-pinned package with strict :file validation, GET+HEAD tests, and 404 envelope (lazy resolve, no startup crash)
- [ ] CSP adds worker-src 'self', has no unsafe-eval, and keeps frame-ancestors 'none', object-src 'none', X-Frame-Options DENY (asserted in tests)
- [ ] Focused suites + lint + typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (task .2 step 0)


## Done summary
Fixed Sol round-3 I1-04: vendor error paths now go through the **same production dispatcher** mounted by server.ts.

- `handlePdfjsVendorRequest` handles all `/vendor/pdfjs/*` (valid + malformed, any method)
- server.ts `fetch` routes the prefix to it (removed valid-only route-map mounts)
- Tests call the identical function
- 404/405 always `withSecurityHeaders` once; exact JSON envelopes
- I1-01…03 and task .2 SHIP preserved

**Remaining gate: independent Sol re-review round 4.** No Sol SHIP claimed.
## Evidence
- Commits:
- Tests: bun test test/serve/fn112-production-routes.test.ts test/serve/api-doc-assets.test.ts test/serve/security.test.ts, bun test test/serve/public/lib/pdf.test.ts, bun run lint:check, bunx tsc --noEmit, git diff --check, .flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json
- PRs: