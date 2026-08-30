# 100% green full test suite before the GNO Recall marketplace release

## Problem

`bun test` on a clean main tree is not clean. Six known failures ride along
and force every release/prerelease verdict to include a "known failures"
classification, which is noise and risk. User: "can we fix these, so it's
100% clean before this omarchy plugin release."

Observed on main (2026-08-30, prerelease run; 4389 pass / 2 skip / 6 fail):

1. `test/scripts/macos-file-provider-smoke.test.ts` - 3 failures, reproduced
   on a clean base commit and in isolated runs on this Linux machine:
   - "probe targeting > cached-unpinned runs independent probes when the
     host prepared a local target"
   - "local hierarchical classification > local mode classifies directories,
     not every discovered file"
   - "benchmark shape > shipped-design protocol and lanes"
   Note: main CI (ubuntu/macos/windows) has been green on these commits, so
   the failures are environment-sensitive (local machine state, cache, or
   fixture assumptions), not universal.
2. "private SPA bundle source serves entry and generated assets" - HTTP 500
   in full-suite runs, passes isolated. Test-interference (shared port,
   build artifact, or global state).
3. Browser clipper package test ("emits non-empty version-matched unpacked,
   archive, and checksum outputs") - full-suite flake, error "Unexpected
   reading file: .../gateway.ts"; isolated run passes. Interference.
4. "committed authoritative agentic baseline > contains the separate closed
   project-affinity promotion" - `artifact_provenance_mismatch` only when
   the working tree is dirty; passes on a clean tree. A dirty tree is the
   normal state during development, so the test must either be robust to it
   or skip with an explicit reason when the tree is dirty.

## Fix

One cluster at a time, root-cause first:

- Diagnose why each fails (environment assumption, shared state, port
  collision, order dependence, dirty-tree provenance input).
- Prefer fixing the test's isolation/assumptions. Fix product code only if
  the test exposes a real bug.
- Skips are a last resort and must be conditional + reasoned (e.g.
  `test.skipIf(<env condition>)` with a comment naming the bound), never
  blanket `.skip`.

## Acceptance

- Two consecutive full `bun test` runs on a clean tree: 0 fail.
- One full `bun test` run with a deliberately dirtied tree (touch a tracked
  file): 0 fail (validates cluster 4).
- Each formerly failing test passes in isolation.
- `bun run lint:check` green. No `.only`/unconditional `.skip` committed.
- CI on main stays green after push.
