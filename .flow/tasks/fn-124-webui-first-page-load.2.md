---
satisfies: [R4, R9]
---
# fn-124-webui-first-page-load.2 Default gno serve to the production bundle

## Description
Make default `gno serve` ship the production bundle unless the operator asked for dev/hot (R4, R9). Parallel with task .1. Do not edit the bundle host or `startServer` isDev formula.

**Size:** S
**Files:** `src/cli/program.ts`, `spec/cli.md`, `test/cli/serve-flags.test.ts`, `docs/WEB-UI.md`
**Touches:** [src/cli/program.ts, spec/cli.md, test/cli/serve-flags.test.ts, docs/WEB-UI.md]

### Approach
- Add an explicit `--dev` flag on `gno serve` (the operator "dev/hot" switch). `package.json` `serve:dev` / `bun --hot` remains the HMR path.
- Plain `gno serve` (unset `NODE_ENV`) must start production. Set `NODE_ENV=production` on the CLI process and on the detached child env unless `--dev` was passed. Leave `startServer`'s `NODE_ENV !== "production"` check alone so `bun test` injected servers stay isDev=true.
- Update `spec/cli.md` first (spec-first), then Commander wiring, then `test/cli/serve-flags.test.ts`. `--dev` does not apply to `--status` / `--stop`.
- `docs/WEB-UI.md` flag table and `NODE_ENV` row: default serve is production; `--dev` is the HMR switch.

### Investigation targets
**Required** (read before coding):
- `src/cli/program.ts:3985-4151` - `wireServeCommand` / `handleServeAction` options and detach spawn env
- `src/serve/server.ts:231` - read-only: `isDev` still follows `NODE_ENV`
- `spec/cli.md` `gno serve` synopsis and options table
- `test/cli/serve-flags.test.ts` - flag routing without booting the server

**Optional** (reference as needed):
- `desktop/electrobun-shell/src/bun/index.ts:140-143` - desktop already forces `NODE_ENV=production`
- `docs/WEB-UI.md:761-788` - flag table and `NODE_ENV=production` row
- `package.json` `serve:dev` script

### Key context
- Investigation measured default CLI serve at ~17.1 MB JS unless `NODE_ENV=production`. Desktop is already production.
- Do not flip every `bun test` `startServer()` call into production. Only the CLI default changes.

### Acceptance
- [ ] `spec/cli.md` documents `--dev` and states default `gno serve` is production
- [ ] CLI start without `--dev` sets `NODE_ENV=production` on the process (and detached child) even when the parent env left it unset
- [ ] `--dev` (and existing `serve:dev` / `bun --hot`) still gets HMR + dev CSP (`ws:`)
- [ ] `--detach` child inherits the same default; `--dev` does not apply to `--status` / `--stop`
- [ ] `bun test test/cli/serve-flags.test.ts` passes
## Acceptance
- [ ] Default `gno serve` is production (not the ~17 MB dev bundle) when `--dev` / `--hot` is absent
- [ ] `spec/cli.md` + `docs/WEB-UI.md` document `--dev` and the new default
- [ ] Detached child inherits production; `--status` / `--stop` unchanged
- [ ] `bun test test/cli/serve-flags.test.ts` passes


## Done summary
Landed via PR #200 (squash ce093b95). Implemented on the contributor branch with done summaries in git; task JSON stayed todo in the export. Reviewed in-host by Gordon's harness (approve), full gate green (4406 tests), bars reproduced locally (P95 first paint 148.9ms, TTI 250.9ms). Released as v1.37.0.
## Evidence
- Commits: ce093b95
- Tests: bun run lint:check, bun test, bun scripts/webui-first-page-load.ts --n 8
- PRs: https://github.com/gmickel/gno/pull/200