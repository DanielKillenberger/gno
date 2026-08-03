---
satisfies: [R4, R5, R7]
---
# fn-114-reliable-watcher-reconciliation-for.3 Harden reconciliation dedupe filters and diagnostics

## Description
Harden reconciliation against noisy/coalesced filesystem events and expose minimal diagnostics sufficient to distinguish watcher activity from successful reconciliation. Deduplicate exact-path candidates with directory-reconciliation candidates in the same debounce batch. Ensure unchanged neighboring files do not emit document-change notifications or schedule embeddings. Keep public status/schema changes out unless existing callbacks/state cannot satisfy the diagnostic contract; any public change requires matching contracts and docs.

## Acceptance
- Repeated events for one collection/directory within a debounce window produce one bounded reconciliation batch.
- A save that emits both an exact final-path event and an ambiguous parent hint produces one material document update, not duplicate notifications or embedding requests.
- Unchanged eligible neighbors are skipped and do not emit `document-changed` events or schedule embedding.
- Excluded, dotfile, temporary, and reserved-path noise remains unindexed and cannot cause a full-collection scan.
- Reconciliation failures reach existing error callbacks/health reporting and do not falsely advance successful-sync diagnostics.
- State/callback evidence identifies the collection and bounded reconciliation scope; any status schema extension has contract tests and documentation.
- Suppressed application-originated writes preserve existing suppression behavior.
- Focused watcher/event/scheduler tests pass; typecheck and `git diff --check` pass.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
