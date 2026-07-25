---
satisfies: [R1, R2, R7, R8]
---
# fn-111-collection-egress-policies.1 Define egress policy schema evaluator and fail-closed migration

## Description
Deliver define egress policy schema evaluator and fail-closed migration as one implementation-sized increment.

**Size:** M
**Files:** `src/core/egress-policy.ts`, `src/config/types.ts`, `src/store/migrations/015-collection-egress.ts`, `src/store/types.ts`, `test/egress/policy.test.ts`

### Approach
- Add effective `local_only|lan|remote` to collection config/store with new and legacy collections defaulting local_only until explicit choice.
- Define one evaluator input for collections/action/destination/caller/auth/content class and stable redacted allow/deny reason codes.
- Enumerate actions and derived classes now; unknown action/destination/policy fails closed, and auth can narrow but never override policy.

### Investigation targets
**Required** (read before coding):
- `src/config/types.ts:71-114`
- `src/store/types.ts:67-130`
- `src/store/migrations/index.ts`
- `src/core/errors.ts`

**Optional** (reference as needed):
- `src/core/config-mutation.ts`
- `spec/db/schema.sql`

### Key context
- Already-public remote artifacts cannot be made private by this migration; disclose irreversibility and block future transfers until policy is explicit.
- A local file export is local; marking/uploading/public publishing is a separate remote action.

## Acceptance
- [ ] Every collection has deterministic effective policy/source and unknowns fail closed with stable codes.
- [ ] Legacy/new migration preserves local retrieval while blocking unapproved new network actions.
- [ ] Evaluator unit tests cover every action/content class and prove authentication cannot relax policy.


## Done summary
Implemented the foundational collection egress-policy contract, persistence, and fail-closed evaluator.

- Added the closed `local_only | lan | remote` policy enum with explicit/default provenance.
- Added migration v23, legacy backfill, rollback, and a database invariant that permits non-local policies only when explicitly configured.
- Propagated policy state through config resolution, collection persistence, status projection, schemas, and typed fixtures.
- Added one pure centralized evaluator with a closed action/destination matrix, most-restrictive multi-collection resolution, authentication checks, stable denial codes, and redacted bounded audit metadata.
- Hardened the untrusted-input boundary against throwing getters, revoked proxies, sparse/oversized arrays, invalid policy/source pairs, and unbounded audit work.
- Added exhaustive action-by-destination, policy/source, migration-constraint, bounded-input, and hostile-input regression coverage.
## Evidence
- Commits: 9ccfd301, 24a7542e
- Tests: bun test test/egress/policy.test.ts test/store/migrations.test.ts test/store/adapter.test.ts test/store/clipper-store.test.ts (70 pass, 0 fail), bun test test/egress test/config test/core test/pipeline test/store (830 pass, 0 fail), bun run lint:check (0 warnings, 0 errors; formatting current), .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json (valid, 0 errors, 0 warnings), git diff --check (clean)
- PRs: