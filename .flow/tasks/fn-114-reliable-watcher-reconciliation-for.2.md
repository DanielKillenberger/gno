---
satisfies: [R3, R6, R8]
---
# fn-114-reliable-watcher-reconciliation-for.2 Make deletion and watcher lifecycle reconciliation correct

## Description
Make deletion and queued-work lifecycle behavior correct under the event shapes observed on Linux. Start by producing a deterministic RED reproduction for the live stale-active behavior or, if the existing fake-watcher deletion test already covers the actual shape, document and test the precise missing shape rather than modifying ingestion speculatively. Reuse existing `syncPaths` missing-path deactivation wherever possible. Ensure queued exact-path and directory-reconciliation work is resolved against the current collection generation and cannot survive collection removal, root change, or disposal.

## Acceptance
- The task records a focused RED reproduction of the deletion/path-shape gap before product code changes.
- Deleting an indexed eligible file after watcher readiness makes it inactive and non-retrievable without a full collection update.
- The implementation reuses existing missing-path deactivation unless evidence proves that seam defective.
- Atomic replacement of an existing eligible file updates that document rather than leaving stale content or duplicate active rows.
- A collection filter/root update before debounce flush is honored; stale queued work is discarded or recomputed against the new generation.
- Collection removal and service disposal prevent queued reconciliation from mutating the old collection.
- Existing exact create/update/delete watcher tests remain green.
- Focused watcher, ingestion, and store tests pass; `git diff --check` passes.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
