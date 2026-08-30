---
satisfies: [R1, R2, R8]
---
# fn-124-webui-first-page-load.4 Measure P95 first paint and TTI on the documented harness

## Description
Document and run one harness for both bars (R1, R2, R8). Same machine story: localhost, production serve, cold JS cache. N defaults to 20 cold loads.

**Size:** M
**Files:** `scripts/webui-first-page-load.ts` (or equivalent name), `docs/WEB-UI.md`, `docs/CLI.md`, `CHANGELOG.md`, `package.json` (script entry)
**Touches:** [scripts/webui-first-page-load.ts, docs/WEB-UI.md, docs/CLI.md, CHANGELOG.md, package.json]

### Approach
- Follow the Playwright spawn pattern in `scripts/web-ui-smoke.ts` (temp config, wait for `/api/health`, Chromium). Force production serve (default CLI or `NODE_ENV=production`). New browser context per sample. Disable JS cache (or equivalent cold-cache rule) and record that rule.
- **R1 first paint:** `performance.timeOrigin` / navigation start → Dashboard shell visible. Shell marker is the `h1` whose name is GNO plus the Search nav button. Do not wait on HealthCenter, BootstrapStatus, or status count cards.
- **R8 TTI:** same navigation start → click Search and observe in-app navigation toward `/search` (URL or history). This is "clicks respond", not a 200ms TTI bar.
- Print N, every sample, P95 (nearest-rank: 19th of 20 sorted), and a one-line harness recipe so a second reviewer can repeat it. Default N=20. If noise forces a higher N, record the new N in the script header and `docs/WEB-UI.md`.
- User-facing docs: how to run the harness, what the two bars mean, that default `gno serve` is production, and that `--dev` is the HMR switch. CHANGELOG Unreleased. Do not claim 200ms TTI. Do not touch other flow specs. Hosted `gno.sh` is out of this workspace; skip it.

### Investigation targets
**Required** (read before coding):
- `scripts/web-ui-smoke.ts` — Playwright + temp-index + production env pattern
- `src/serve/public/pages/Dashboard.tsx:377-512` — header `h1` GNO and Search nav button (shell vs HealthCenter)
- `docs/WEB-UI.md:761-788` and `docs/CLI.md` `gno serve` section

**Optional** (reference as needed):
- `package.json` `test:e2e` / `test:e2e:install`
- `CHANGELOG.md` Unreleased headings

### Key context
- Filled health data is not a bar. A sample that waits on `/api/status` cards is invalid for R1/R8.
- Harness is documented and local. Do not add a mandatory CI perf gate on this spec.

### Acceptance
- [ ] Script runs N cold production loads (default 20) and prints P95 first-paint and P95 TTI
- [ ] R1 uses Dashboard shell selectors, not HealthCenter; R8 uses Search click → `/search`
- [ ] Docs record N, harness, cache rule, selectors, and the two bars without a 200ms TTI claim
- [ ] CHANGELOG Unreleased updated; `docs/CLI.md` / `docs/WEB-UI.md` match the production default

## Acceptance
- [ ] Documented harness (N default 20, localhost, production, cold JS cache) prints P95 first-paint and P95 TTI
- [ ] First paint = nav start → `h1` GNO + Search visible; TTI = nav start → Search click navigates; health cards excluded
- [ ] `docs/WEB-UI.md`, `docs/CLI.md`, and CHANGELOG describe the bars and production default without a 200ms TTI claim


## Done summary
Landed via PR #200 (squash ce093b95). Implemented on the contributor branch with done summaries in git; task JSON stayed todo in the export. Reviewed in-host by Gordon's harness (approve), full gate green (4406 tests), bars reproduced locally (P95 first paint 148.9ms, TTI 250.9ms). Released as v1.37.0.
## Evidence
- Commits: ce093b95
- Tests: bun run lint:check, bun test, bun scripts/webui-first-page-load.ts --n 8
- PRs: https://github.com/gmickel/gno/pull/200