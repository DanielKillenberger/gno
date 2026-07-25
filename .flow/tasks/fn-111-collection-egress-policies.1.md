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
Added the fail-closed collection egress policy foundation. Collection config now accepts an explicit local_only, lan, or remote policy while preserving absence for legacy provenance; resolution defaults safely to local_only. SQLite migration 23 persists effective policy/source with closed constraints, legacy backfill, rollback, conflict-safe provenance preservation, status projection, and explicit-to-omitted tightening. A shared redacted evaluator now validates collection identity, action/destination compatibility, caller authorization/authentication, all source/derived content classes, and most-restrictive mixed-collection policy with stable allow/deny reasons. Added migration, adapter, malformed-input, full action/content matrix, authentication, restrictive-mix, and redaction coverage.
## Evidence
- Commits: 9ccfd301
- Tests: bun test test/egress/policy.test.ts test/store/migrations.test.ts test/store/adapter.test.ts test/store/clipper-store.test.ts (66 pass, 0 fail), bun test test/egress test/config test/core test/pipeline test/store (826 pass, 0 fail), bun test test/egress/policy.test.ts test/store/migrations.test.ts (16 pass, 0 fail after final constraint cases), bun run lint:check (type-aware oxlint and oxfmt check passed), .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json (valid, 0 errors, 0 warnings)
- PRs: