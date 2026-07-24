---
satisfies: [R2, R3, R4]
---
# fn-110-file-and-export-first-source-adapters.1 Add the streaming multi-record ingestion adapter contract

## Description
Deliver add the streaming multi-record ingestion adapter contract as one implementation-sized increment.

**Size:** M
**Files:** `src/ingestion/record-adapter.ts`, `src/ingestion/record-sync.ts`, `src/converters/types.ts`, `src/store/types.ts`, `test/ingestion/record-adapter.test.ts`

### Approach
- Introduce container adapters that yield bounded canonical records with adapter/version, stable record ID, source locator/hash, metadata, anchors, warnings, and retryability while preserving existing one-file converter behavior.
- Define full-success snapshot tombstones versus partial/failed imports: removals deactivate only after a complete authoritative snapshot; partial runs never infer deletion.
- Stream records and isolate malformed items with per-record receipts, caps, quarantine metadata, and no arbitrary archive/URL expansion.

### Investigation targets
**Required** (read before coding):
- `src/converters/registry.ts:1-80`
- `src/converters/types.ts:47-120`
- `src/converters/pipeline.ts`
- `src/ingestion/sync.ts`
- `src/store/types.ts`

**Optional** (reference as needed):
- `src/store/content-batch.ts`
### Key context
- Stable record identity is adapter-defined under one contract; original container file identity alone is insufficient.
- Attachments are inventory/provenance only in V1 unless inline safe text is part of the source record.

## Acceptance
- [ ] Existing one-file converters remain compatible while streaming adapters yield deterministic independent records.
- [ ] Complete snapshot re-import updates/deactivates by stable ID/hash; partial failure never tombstones unseen siblings.
- [ ] One malformed/oversized record is isolated and valid siblings continue within global/record caps.


## Done summary
Added a separate streaming record-adapter lane with bounded source/record/metadata/failure caps, deterministic domain-separated identity and canonical hashes, isolated failures, authoritative snapshot semantics, and pure update/reactivate/deactivate reconciliation. Legacy one-file converter routing remains byte-compatible. Adversarial review found no remaining P1/P2 issues.
## Evidence
- Commits: 466eaca4
- Tests: bun run lint:check, bun test test/converters test/ingestion (286 pass), task review SHIP
- PRs:
