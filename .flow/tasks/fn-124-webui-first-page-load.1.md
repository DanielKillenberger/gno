---
satisfies: [R5, R3, R9]
---
# fn-124-webui-first-page-load.1 Emit split chunks on the production serve path

## Description
Make the production WebUI serve path emit split JavaScript chunks (R5, R3 first-file split, R9). This is the early proof. Route-lazy work must not start if HTML still inlines one monolith.

**Size:** M
**Files:** `src/serve/server.ts`, `src/serve/spa-bundle-source.ts`, `test/serve/spa-bundle-source.test.ts`
**Touches:** [src/serve/server.ts, src/serve/spa-bundle-source.ts, test/serve/spa-bundle-source.test.ts]

### Approach
- Keep the private bundle host and the public `fetch` proxy that already forwards non-404 assets (`server.ts` production HTML cache + `spa-bundle-source.ts`).
- On the production path (`development: false`), stop inlining the app as one ~11.8 MB script. Use Bun HTMLBundler splitting or `Bun.build` with splitting (the investigation SHA already produced a ~3.86 MB entry plus extra files). Serve every chunk URL the HTML references on the public listener.
- Extend `test/serve/spa-bundle-source.test.ts` so production HTML has an external first JS file and at least one additional JS chunk, and each referenced asset returns 200 through `source.fetch`.
- Do not add Vite, SSR, or a new framework. Do not change route modules or Shiki in this task.

### Investigation targets
**Required** (read before coding):
- `src/serve/server.ts:26` and `src/serve/server.ts:307-380` — HTMLBundle import, `spaHtmlCache`, `serveSpaHtml`
- `src/serve/server.ts:1306-1314` — public proxy of private bundle assets
- `src/serve/spa-bundle-source.ts` — Unix socket / Windows loopback host
- `test/serve/spa-bundle-source.test.ts` — current single-asset assertion

**Optional** (reference as needed):
- `src/serve/server.ts:151-173` — production CSP (`script-src 'self'`)
- `scripts/web-ui-smoke.ts:115` — existing production-env smoke

### Key context
- Investigation SHA `b6c7bff`: production HTMLBundle inlined ~11.8 MB JS (~2.4 MB gzip) as one chunk. `bun build --splitting` already split pdf/graph/shiki langs off a ~3.86 MB entry. Existing `React.lazy` is a no-op until this task emits real files.
- If production HTML is still one inlined script after this task, stop the spec's later tasks.

### Acceptance
- [ ] Production (`development: false`) HTML references an external first JS module instead of inlining the ~11.8 MB app
- [ ] That HTML also references at least one additional JS chunk, and every `src`/`href` asset returns 200 via the private source (Unix and, if touched, Windows host)
- [ ] Public listener proxy still wraps those assets in `withSecurityHeaders` (production CSP, no `ws:`)
- [ ] No SSR, Vite, or new UI framework
- [ ] `bun test test/serve/spa-bundle-source.test.ts test/serve/security.test.ts` passes

## Acceptance
- [ ] Production HTML emits a split first JS file plus at least one extra JS chunk, all reachable with 200 through the private bundle source
- [ ] Public proxy applies production security headers; no inlined ~11.8 MB app script remains
- [ ] No SSR / new framework
- [ ] `bun test test/serve/spa-bundle-source.test.ts test/serve/security.test.ts` passes


## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
