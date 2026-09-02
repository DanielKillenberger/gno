---
satisfies: [R6, R7]
---
# fn-136-pdf-viewing-over-a-remote-link.5 Remote-link verification, docs, CHANGELOG, and gno.sh

## Description
Close the spec. Measure R6 and R7 over the real relayed VPN link to the remote host with all four implementation tasks landed, measure the warm-reload JavaScript transfer for R3, refresh the SPA snapshot, and finish the documentation set including the hosted site. Depends on tasks .1 to .4.

**Size:** M
**Files:** `assets/spa-production.json.gz` (via `bun run build:spa`), `CHANGELOG.md`, `docs/API.md`, `docs/WEB-UI.md`, `src/serve/CLAUDE.md`, and the REST API, web UI, and remote-access pages in the external repo `~/work/gno.sh`
**Touches:** [assets/spa-production.json.gz, CHANGELOG.md, docs/API.md, docs/WEB-UI.md, src/serve/CLAUDE.md]

External repository note: `~/work/gno.sh` is a separate git repository, so its pages cannot be declared in Touches or locked by the wave dispatcher. This task runs alone in its wave and edits, drives, and commits the site pages serially after the in-repo changes.

### Approach
- Run `bun run build:spa` so the committed snapshot carries the client changes from .3 and .4.
- Cold measurement (R6): start `gno serve` on the remote host behind its existing proxy, open a 50-page PDF of about 5 MB from this machine with an empty cache, and capture the browser network panel: request count, transferred bytes, time to first painted page, and the current VPN ping round trip to the remote host. Compare with the task .3 numbers. If the remote host is unreachable, record BLOCKED, never PASS.
- Warm measurement (R3): reload the same document page with the cache intact and record transferred JavaScript bytes and the cache state of the hashed chunks; the target is under 100 KB.
- Sharpness (R7): capture a screenshot from the remote browser with its reported device pixel ratio and viewport. If the page is sharp, R7 is met. If it is still blurry, attach the capture (DPR, viewport, browser, page count) to the spec, add a follow-up task to this spec, and leave R7 unmet in the requirement coverage table; the spec must not be closed while R7 is unmet.
- CHANGELOG `[Unreleased]`: Changed entries for doc-asset caching, SPA compression, PDF transport and first paint; Added entry for `localClient`, the reveal 403, and the locality-aware actions.
- Add the transport paragraph to `docs/WEB-UI.md` Native PDF Viewer (line about 256-295): small PDFs load whole after a HEAD size probe, large PDFs use 1 MB range chunks with background fetching, and page 1 paints before all page geometry resolves. Then reconcile `docs/API.md`, `docs/WEB-UI.md`, and `src/serve/CLAUDE.md` for any wording the implementation tasks left inconsistent, then mirror the REST API, web UI, and remote-access pages in `~/work/gno.sh` and drive the changed pages locally per the Live QA Gate in `CLAUDE.md` before merging there.

### Investigation targets
**Required** (read before coding):
- `CLAUDE.md` sections "Live QA Gate" and "Avoiding Documentation Drift"
- `notes/pdf-remote-viewing-investigation.md` — the verification plan and the numbers measured on 2026-09-02

**Optional** (reference as needed):
- `docs/API.md:1397-1484` — doc-asset and vendor asset sections
- `docs/WEB-UI.md:256-295` — Native PDF Viewer

### Key context
- A VPN ping to the remote host measured 202 to 204 ms through a relay with no direct path on 2026-09-02. Compare against the current round trip when measuring.
- `~/work/gno.sh` was not present on this machine during planning; clone it before the docs mirror step.
- Confirm during the measurement which mechanism exposes `gno serve` on the remote host (a reverse proxy, a port forwarder, or an SSH tunnel) and record it; the spec's open question depends on it.
## Acceptance
- [ ] Cold network capture over the relay shows first paint under 2 s and under 30 requests for the fixture, or a recorded BLOCKED with the reason
- [ ] Warm reload capture shows under 100 KB of JavaScript transferred with hashed chunks served from cache
- [ ] Remote screenshot with DPR and viewport attached; if sharp, R7 met; if blurry, the capture is attached, a follow-up task is added, R7 stays unmet in the coverage table, and the spec stays open
- [ ] The exposure mechanism on the remote host is recorded in the done summary
- [ ] `assets/spa-production.json.gz` rebuilt and committed
- [ ] CHANGELOG, `docs/API.md`, `docs/WEB-UI.md`, `src/serve/CLAUDE.md` updated; `~/work/gno.sh` pages updated and driven locally
- [ ] `bun run lint:check` and `bun test` pass
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
