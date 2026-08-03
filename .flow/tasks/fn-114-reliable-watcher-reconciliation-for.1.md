---
satisfies: [R1, R2, R4, R8]
---
# fn-114-reliable-watcher-reconciliation-for.1 Implement bounded atomic-write reconciliation test-first

## Description
Implement the smallest bounded watcher reconciliation for atomic saves. Before editing product code, capture the real Bun/Linux event sequence and add a deterministic regression that fails on the pristine watcher. Preserve that RED result as Flow task evidence, then make the test green within this task. Exact eligible-path events must retain the current incremental fast path. Ambiguous or ineligible event paths may reconcile only the smallest trustworthy directory, generically and without editor-specific filenames. Add a store query seam only if current APIs cannot efficiently enumerate active direct-child documents.

## Acceptance
- A real temporary-directory probe records event sequences for direct write, atomic create, and atomic replacement on Linux/Bun, with cleanup and hard timeout.
- A deterministic injected-watcher test is shown failing against pristine upstream because an eligible final file is not indexed when only an ineligible temporary-path event is reported.
- The same focused test passes after the implementation.
- Exact eligible create and update events still call the incremental path without directory reconciliation.
- Ambiguous atomic-save events reconcile only the direct affected directory and discover the eligible final file.
- No implementation special-cases Hermes or any named editor/temp-file pattern.
- Current include/exclude/pattern/reserved-path rules remain authoritative; temporary and excluded files are not indexed.
- `bun test test/serve/watch-service.test.ts` and any added focused store tests pass.
- `git diff --check` passes.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
