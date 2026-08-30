# fn-124 completion review — Sol round 2

Reviewed implementation head `08bb351c48e301114b45c183565d8815d538026e`
against merge base `b6c7bffe0ba3de22ef4fa260ba43914b947c0934`,
the fn-124 spec, and the owner-forwarded compiled-executable/platform
constraint. Round 1's `NEEDS_WORK` was treated as prior findings to re-verify,
not as the round-2 verdict.

## Requirements Extracted

1. R1: P95 navigation-to-visible-home-chrome paint is at most 200 ms on
   localhost production serve with a cold JavaScript cache.
2. R2: The shared measurement method records N, selectors, cache rule, and
   nearest-rank P95 math.
3. R3: Production serves a split first JavaScript entry without PDF, graph, or
   unused Shiki grammar payloads.
4. R4: Plain `gno serve`, including detach, defaults to production; explicit
   `--dev` retains the development/HMR path without changing status/stop.
5. R5: Production HTML and all referenced chunks are reachable through the
   existing private source/public security-header proxy.
6. R6: Non-home routes load after home; unknown paths retain the Dashboard
   fallback.
7. R7: Highlighting is delayed/allowlisted and unknown fence languages safely
   fall back to text.
8. R8: P95 navigation-to-responsive-Search-click is at most 1 second on the
   same cold-cache harness.
9. R9: Delivery remains the current client SPA, without SSR, Vite, a new
   framework, or retrieval/KB/MCP changes.
10. The production split must survive `bun build --compile --splitting`:
    execute on Linux and cross-compile for shipped Windows and macOS targets,
    with no runtime `Bun.build` against `/$bunfs`.

## Coverage Verification

1. R1 — COVERED — `scripts/webui-first-page-load.ts:123-192` checks computed
   visibility and non-zero geometry, waits a following double-rAF paint frame,
   and measures from the document performance origin. A clean-host N=20 run on
   pinned Bun 1.3.14 published P95 first paint **167.3 ms**, below 200 ms.
2. R2 — COVERED — `scripts/webui-first-page-load.ts:1-28,199-225` and
   `docs/WEB-UI.md:799-821` document N=20, new contexts plus disabled network
   cache, the `h1`/Search selectors, exclusions, recipe, and nearest-rank math.
3. R3 — COVERED — `src/serve/spa-production-build.ts:75-123` emits splitting
   assets and deliberately selects the root-mount entry; the focused first-file
   assertion passes. The embedded snapshot exactly matches a fresh pinned-Bun
   build: 408 files and entry `/chunk-qqsh47aj.js`.
4. R4 — COVERED — `src/cli/program.ts:4037-4055,4136,4325` resolves production
   by default and propagates it to detached children. The serve-flags suite
   passes.
5. R5 — COVERED — `src/serve/spa-bundle-source.ts:47-97,102-174` hosts every
   split asset on Unix sockets or Windows loopback;
   `src/serve/server.ts:1306-1317` proxies successful assets through
   `withSecurityHeaders`. Source and compiled asset-reachability tests pass.
6. R6 — COVERED — `src/serve/public/app.tsx:42-80,159-163` lazily imports all
   named non-home routes and preserves Dashboard fallback; `/clipper/pair`
   retains its separate branch at `src/serve/public/app.tsx:378-383`.
7. R7 — COVERED — `src/serve/public/components/ai-elements/code-block.tsx:36-45`
   creates the highlighter only on demand, while
   `src/serve/public/lib/code-language.ts:32-45` uses the string allowlist and
   text fallback. Focused unknown-language tests pass.
8. R8 — COVERED — `scripts/webui-first-page-load.ts:179-192` clicks Search and
   observes `/search`. The same clean-host N=20 run published P95 TTI
   **279.9 ms**, below 1 second.
9. R9 — COVERED — the implementation remains React/Bun's client SPA and does
   not touch retrieval, knowledge-base, or MCP behavior.
10. Compiled/platform gate — COVERED —
    `src/serve/spa-production.ts:19-41` switches standalone executables to the
    embedded gzip snapshot; `test/serve/spa-compile-executable.test.ts:29-70`
    compiles with `--compile --splitting`, executes the real source on Linux,
    proves `bundle.index` is under `/$bunfs` while the mount entry and document
    assets return successfully, and cross-compiles `bun-windows-x64` and
    `bun-darwin-x64`. It passes on both Bun 1.3.14 and Bun 1.4.0.

## Round-1 P1 Re-verification

- CR-01: resolved. Linux standalone runtime passes without the prior ENOENT;
  Windows and macOS cross-compiles pass. The committed snapshot is byte-for-byte
  identical to a fresh build under the pinned Bun 1.3.14 toolchain.
- CR-02: resolved. The production home visibly renders `h1` GNO and the Search
  navigation on this clean host and publishes both P95 values.
- CR-03: resolved. The metric now requires visible computed style, non-zero
  geometry, and a subsequent paint frame instead of accepting DOM insertion.

## Reverse Coverage (untraced changes)

None. Product, test, script, documentation, and snapshot files trace to
R1-R9 or the compiled/platform constraint. The `.flow/specs`, `.flow/tasks`,
and prior review record are legitimate workflow support artifacts.

## Gaps Found

None.

## Pre-existing issues

None affecting spec completion.

Requirements coverage: R1, R2, R3, R4, R5, R6, R7, R8, R9.
Unaddressed R-IDs: none.
Suppressed findings: 0.
Classification counts: introduced=0, pre_existing=0.

## Passing gates

- `bun run bench:webui-first-page` on pinned Bun 1.3.14 — N=20, first-paint
  P95 167.3 ms, TTI P95 279.9 ms
- `bun test test/serve/spa-compile-executable.test.ts --timeout 180000` on Bun
  1.3.14 and Bun 1.4.0
- Focused fn-124 suite — 55 pass, 0 fail
- `bun test` — 3836 pass, 2 skip, 0 fail
- `bun run lint:check`
- `bun run typecheck`
- `bun run docs:verify` — 15 pass, 2 model-dependent skips
- `.flow/bin/flowctl validate --spec fn-124-webui-first-page-load --json`

<verdict>SHIP</verdict>
