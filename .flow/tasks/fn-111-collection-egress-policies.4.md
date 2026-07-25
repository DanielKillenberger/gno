---
satisfies: [R3, R6, R7]
---
# fn-111-collection-egress-policies.4 Propagate restrictive policy through mixed and derived data with audit

## Description
Deliver propagate restrictive policy through mixed and derived data with audit as one implementation-sized increment.

**Size:** M
**Files:** `src/core/egress-provenance.ts`, `src/core/egress-audit.ts`, `src/core/context-capsule.ts`, `src/core/retrieval-trace.ts`, `src/core/retrieval-trace-management.ts`, `src/core/retrieval-trace-management-types.ts`, `src/store/types.ts`, `src/publish/artifact.ts`, `test/egress/derived-policy.test.ts`

### Approach
- Attach source collection policy lineage to snippets, embeddings, Capsules, traces, journal records, clip/export artifacts, and multi-record sources; transformation never declassifies.
- For mixed collections, compute most restrictive effective policy and require explicit disclosed partial-result semantics before omitting denied sources.
- Write bounded local allow/deny audit receipts with operation/destination zone/policy/reason/timestamp and hashes only; support retention/inspect/purge transactionally.
- Extend existing retrieval trace records and `RetrievalTraceArtifact` with policy lineage through the established trace codec/schema path; do not replace `RetrievalTraceManagementService`, its list/show/label/export/delete/purge result types, or the v14 trace tables. Existing explicit relevance judgments remain semantically independent from egress allow/deny decisions.
- Apply lineage before `RetrievalTraceManagementService.export` computes the canonical artifact hash and calls `appendRetrievalTraceExportManifest`. Aggregate manifests retain sorted immutable membership and the most restrictive effective source policy; a mixed-source denial cannot be hidden by exporting only an allowed subset under the old manifest identity.
- Keep egress audit receipts in their own bounded store/service contract. Reuse task-3 patterns for cursor pagination, bounded detail, exact cascade counts, durable redaction, and truthful physical purge status, but never place audit decisions into retrieval judgments or make trace purge silently purge a distinct audit domain.

### Investigation targets
**Required** (read before coding):
- `src/publish/artifact.ts`
- `src/store/types.ts`
- `src/config/types.ts`

**Optional** (reference as needed):

**Planned dependency outputs** (expected by execution; not plan-time investigation sources):
- `src/core/context-capsule.ts`
- `src/core/retrieval-trace.ts`
- `src/core/change-journal.ts`
- `src/core/browser-clip.ts`
- `src/ingestion/record-adapter.ts`

## Acceptance
- [ ] Derived artifacts retain the most restrictive source lineage across all declared types.
- [ ] Mixed-source deny/explicit-partial behavior is deterministic and cannot silently omit restricted evidence.
- [ ] Audit inspect/retention/purge works locally and stores no content, credentials, query text, or sensitive absolute paths.
- [ ] Retrieval trace management remains schema-compatible and explicit-label-only after lineage is added; aggregate artifact/manifest hashes bind the effective policy without reinterpreting relevance or terminal outcomes.

<!-- Updated by plan-sync (cross-spec): fn-100-private-retrieval-learning-loop.3 shipped the trace management, aggregate manifest, pagination, redaction, and purge patterns -->


## Done summary
Completed restrictive egress propagation and audit hardening across Context Capsules, retrieval traces, publishing artifacts, change journals, and persisted receipts.

- Enforced canonical, duplicate-free lineage with fail-closed unknown-owner handling.
- Bound Capsule 1.1 aggregate lineage to requested scope plus every materialized evidence owner before identity hashing.
- Added atomic audit insert-and-retention with decision recomputation and tamper rejection.
- Added explicit trace creation-digest migration marker, safe legacy retry normalization, and persisted scope widening from actual evidence.
- Validated artifact lineage before emission and added adversarial, migration, trace, and regression coverage.

Validation:
- `bun run lint:check`
- `bun test` — 3,418 passed, 2 expected skips, 0 failed
- `bun run docs:verify` — 13 passed, 2 model-cache skips, 0 failed
- `bun run test:package` — passed on clean bounded retry after one transient freed-port collision
- Targeted adversarial egress suite — 61 passed, 0 failed
- Retrieval trace/replay suite — 65 passed, 0 failed
- Affected search/hybrid suite — 21 passed, 0 failed
## Evidence
- Commits: 19554534, f212e228, 5bbb1187, c61b1638, 016e3f16, 48247149
- Tests: bun run lint:check, bun test (3418 pass, 2 expected skips, 0 fail), bun run docs:verify (13 pass, 2 model-cache skips, 0 fail), bun run test:package, targeted adversarial egress tests (61 pass, 0 fail), retrieval trace and replay tests (65 pass, 0 fail), affected search and hybrid tests (21 pass, 0 fail)
- PRs: