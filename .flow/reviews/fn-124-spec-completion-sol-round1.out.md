# fn-124 completion review — Sol round 1

Reviewed implementation head `4d4c2e847ff3a62a4a0ce173c0222ac2aee409f3`
against merge base `b6c7bffe0ba3de22ef4fa260ba43914b947c0934`,
the fn-124 spec, and the owner-forwarded requirement that the production SPA
split work from a Bun compile single-file executable on every shipped platform
(at least Linux, macOS, and Windows).

## Findings

### P1 — CR-01: the production split cannot start from a compiled executable

`createSplitProductionSource()` passes `bundle.index` back to runtime
`Bun.build()` (`src/serve/spa-bundle-source.ts:60-77`). In a standalone
executable, Bun replaces the HTML import with an embedded manifest whose index
is under `/$bunfs/root`. An isolated probe importing the real
`src/serve/public/index.html` and calling the real `createSpaBundleSource()`
compiled successfully, then failed at runtime:

```text
{"bundleIndex":"/$bunfs/root/index-eenebfbp.html","bundleKeys":["index","files"],"standalone":true}
error: ENOENT: failed to open root directory: /$bunfs/root
      at createSplitProductionSource (/$bunfs/root/fn124-compile-probe:33:29)
```

The probe was built with `bun build --compile --splitting`. The same isolated
probe cross-compiled successfully for `bun-windows-x64` and
`bun-darwin-x64`, but cross-compilation alone cannot exercise either target.
Both targets retain the same runtime call that failed on Linux. There is no
compiled-executable test or per-platform runtime evidence in the branch.

The complete command
`bun build --compile --splitting src/index.ts --outfile /tmp/gno-fn124`
also fails before producing an executable because the existing dependency
graph contains unresolved optional `node-llama-cpp` platform packages and
`youtube-transcript`. The isolated probe removes that pre-existing obstacle
and demonstrates that fn-124's new SPA path independently fails once compiled.

This fails the added executable/platform gate and R5 for that required
distribution mode.

### P1 — CR-02: the documented acceptance harness publishes no P95 on a clean host

After installing the documented Chromium prerequisite,
`bun run bench:webui-first-page` started the production server but failed its
first sample:

```text
GNO server running at http://127.0.0.1:43474
Missing shell selector: h1 GNO and/or nav Search button
error: script "bench:webui-first-page" exited with code 1
```

The failure reproduced with `--n 1`. Diagnostic reruns showed the document,
entry JavaScript, CSS, and initial static chunks returning HTTP 200, while
`#root` remained empty and no `nav` appeared. Extending the diagnostic selector
deadline from 5 seconds to 30 seconds did not make the sample complete. The
temporary diagnostics were reverted.

Because the committed harness exits without either reported P95, this review
cannot establish R1 or R8 on the required localhost production/cold-JS-cache
surface. A prior implementer-machine result is not a substitute for this
completion-review run.

### P1 — CR-03: the R1 measurement observes DOM text, not painted visible chrome

`scripts/webui-first-page-load.ts:124-148` resolves as soon as an `h1` and a
button containing `Search` exist in the DOM. The initial check runs
synchronously; it does not test CSS visibility or geometry and does not wait
for a paint after insertion. An element that is hidden or not yet painted can
therefore satisfy the measurement. Naming the boolean `searchVisible` does not
make it a visibility check.

R1 is explicitly navigation start to first paint of visible Dashboard chrome.
The committed measurement can under-report that bar and therefore cannot be
used as its proof.

## Requirement disposition

| Requirement | Result | Review evidence |
| --- | --- | --- |
| R1 | Fail | Harness publishes no P95 here; metric is DOM presence rather than paint |
| R2 | Pass | N, cache rule, selectors, recipe, and nearest-rank math are documented |
| R3 | Pass for source-run serve | Split entry and forbidden-payload focused tests pass |
| R4 | Pass | Plain CLI serve resolves production and detach forwards the mode |
| R5 | Fail | Source-run chunks are reachable; compiled executable fails before serving |
| R6 | Pass | Non-home routes are lazy and Dashboard remains the fallback |
| R7 | Pass | Grammar IDs no longer value-import grammars; unknown language falls back |
| R8 | Fail | Harness publishes no TTI P95 on this review host |
| R9 | Pass | Changes stay within the current client SPA |
| Compiled/platform gate | Fail | Linux runtime failure; no macOS/Windows runtime proof |

## Passing gates

- `bun test` — 3834 pass, 2 skip, 0 fail
- focused fn-124 suite — 54 pass, 0 fail
- `bun run lint:check`
- `bun run typecheck`
- `bun run docs:verify` — 15 pass, 2 model-dependent skips
- `.flow/bin/flowctl validate --spec fn-124-webui-first-page-load --json`

The green source and unit gates do not override the failed live acceptance
harness or the directly reproduced standalone-executable failure.

<verdict>NEEDS_WORK</verdict>
