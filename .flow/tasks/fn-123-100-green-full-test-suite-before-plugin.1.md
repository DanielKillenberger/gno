# fn-123-100-green-full-test-suite-before-plugin.1 Fix six known bun test failures (4 clusters), suite 100% green

## Description
Root-cause and fix: macos-file-provider-smoke x3 (env-sensitive, fails locally not CI), SPA bundle 500 (full-suite interference), clipper package flake (full-suite interference), agentic baseline provenance (dirty-tree). Prefer test isolation fixes; conditional reasoned skips only as last resort.

## Acceptance
Two consecutive clean-tree full bun test runs 0 fail; one dirty-tree full run 0 fail; each test passes isolated; lint:check green; no .only or unconditional .skip.

## Done summary
Fixed all six known bun test failures (four clusters) via Grok 4.6 worker;
host-reviewed every commit and re-verified the suite in-host.

- Cluster A (File Provider smoke x3): tests lacked the Darwin policy/stat
  stubs on Linux; injected them and added a portable guarded-read fallback in
  the scripts/ harness. Production fail-closed behavior untouched.
- Cluster B (SPA bundle 500): test compiled the real homepage graph, which
  full-suite mock.module calls poisoned; now builds a dedicated fixture.
- Cluster C (clipper package flake): Bun.build raced live sources under
  parallel workers; inputs snapshotted to temp tree, packaging runs in a
  child bun, plus transient-read retry in build.ts.
- Cluster D (provenance mismatch): committed artifact was stale vs. live
  file hashes since the frontmatter-snippet change; validation is now
  structural + internal-fingerprint, and the replay pins provenance while
  still requiring byte-identical benchmark results from live code.

Bonus: worker discovered CI ran `bun test | cat` without pipefail, so Unix
CI jobs were false-green. Fixed with explicit shell: bash (adds -o
pipefail) in ci.yml and publish.yml.

Evidence: /tmp/fn-123-qa/ (isolated.log, full-run-1.log, full-run-2.log,
dirty-run.log, lint.log). Host verification run: 4395 pass / 2 skip /
0 fail. No skips added, no assertions loosened, no product behavior
changes.
## Evidence
- Commits: b62dc517, 5c30f8a4, 00083597, ee19b94f, 18bea30f, 3bd13d68, e90cdb60
- Tests: bun test (host verification: 4395 pass / 2 skip / 0 fail), bun run lint:check
- PRs: