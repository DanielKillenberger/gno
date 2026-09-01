---
satisfies: [R3, R6]
---
# fn-132-wired-loop-capture-parity-changes.4 Scheduled findings pass in daemon

## Description
Scheduled findings pass (audit only). **Size:** M. **Files/Touches:** daemon task loop (src/serve/resident-runtime.ts area), src/config/types.ts (new `findings` config block), findings record writer, docs (daemon section + CONFIGURATION.md), tests.
DESCOPED per plan review: saved-Capsule reverification stays on its existing journal-driven scheduler and is NOT part of this pass (calling it on cadence is a no-op by design — src/core/capsule-reverification-scheduler.ts). This task = scheduled READ-ONLY `gno audit` runs writing findings records.
Config contract (binding): `findings: { enabled: false, cadence: "<duration>", collection: "<name>" }` — enabling REQUIRES the named collection to already exist in config (explicit operator setup; the daemon never mutates config or writes outside a configured source path; misconfig → clear startup error). Record identity deterministic: id = hash(check-kind + target-uri + finding-content) → repeated runs upsert, no duplicate corpus; bounded retention documented. Observability contract: last-run state persisted (success | failed | skipped_lease | overdue, with timestamps and finding counts) and exposed via gno daemon --status (and doctor), so a starved or failing scheduler is distinguishable from a clean one without debug logs. Silent when clean; skips (recorded as skipped_lease) when a writer holds the lease.

**Touches:** src/serve/resident-runtime.ts (task loop), src/config/types.ts (findings block), findings record writer module (new), daemon status surface, docs (daemon + CONFIGURATION.md), tests

## Acceptance
- [ ] Config block validates; enabled-without-collection fails startup with a clear message; daemon never writes outside the configured collection path
- [ ] Seeded broken link produces a findings record on cadence; second run does not duplicate it (identity test); fix removes it or marks resolved per documented semantics
- [ ] Clean run writes nothing and logs nothing beyond debug; lease-held run skips
- [ ] Docs: daemon + CONFIGURATION.md; capsule-reverification explicitly documented as out of this pass

- [ ] gno daemon --status shows last findings-run state/timestamps; a forced failure and a lease-skip are both visible there (live test)

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
