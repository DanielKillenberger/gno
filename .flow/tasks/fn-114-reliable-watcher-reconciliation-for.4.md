---
satisfies: [R1, R2, R3, R4, R5, R6, R7, R8]
---
# fn-114-reliable-watcher-reconciliation-for.4 Verify the integrated watcher fix on Linux

## Description
Run the integrated verification gate and reduce the change to a reviewable upstream bug-fix diff. Exercise the real watch-to-sync lifecycle in a Linux temporary directory using watcher-readiness and settled callbacks instead of fixed sleeps. Confirm normal copy/write, atomic create/replacement, deletion, exclusions, current-config behavior, and restart/disposal behavior. Update user-facing documentation only if a public contract actually changed.

## Acceptance
- A real Linux/Bun temporary-directory smoke test proves an eligible atomic-save result becomes retrievable without `gno update`.
- The smoke also proves an indexed eligible file becomes inactive after deletion.
- Tests synchronize on watcher readiness and settled callbacks; arbitrary fixed sleeps are not used as correctness assertions.
- Ordinary eligible create/update remains incremental and green.
- Excluded/temp files remain unindexed; repeated/coalesced events do not duplicate notifications or embedding work.
- `bun test test/serve/watch-service.test.ts` passes.
- Relevant `test/ingestion/` and `test/store/` suites pass.
- The repository canonical lint/check command and `bunx tsc --noEmit` pass.
- The full relevant suite passes with no new skips or flakes.
- `git diff --check` passes and the diff contains no timer fallback, editor-specific special case, frontend change, generated telemetry, or unrelated cleanup.
- Any public behavior/schema change is documented; otherwise no incidental docs churn is included.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
