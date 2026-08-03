---
satisfies: [R5, R6]
---

# fn-71-bundled-image-attachments-in-publish-export.4 Validate and transactionally ingest v1 assets on gno.sh
## Description
Implement gno.sh's strict v1 consumer/transaction boundary: whole-artifact validation, immutable private object persistence, sentinel completeness, and idempotent publish/republish/delete/rollback/orphan lifecycle before any snapshot generation becomes visible.

**Size:** M
**Files:** `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts`, `/Users/gordon/work/gno.sh/src/lib/server/storage.ts`, `/Users/gordon/work/gno.sh/src/lib/source-catalog.ts`, `/Users/gordon/work/gno.sh/test/`

## Approach
- Validate schema/capabilities, signatures, dimensions, length, digest, IDs, and every sentinel before visibility.
- Use opaque immutable keys and private storage by default.
- Commit snapshot/catalog visibility only after its complete asset generation is durable.
- Make retries, republish, delete, rollback, and orphan cleanup idempotent with content-free receipts.

## Investigation targets
**Required** (read before coding):
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts:47-98,117-152,211-228` — current ingest/sanitization/snapshot
- `/Users/gordon/work/gno.sh/src/lib/server/storage.ts:53-83` — current JSON-only S3 layer
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact-client.ts:11` — upload limit
- `/Users/gordon/work/gno.sh/src/lib/source-catalog.ts:60-70` — current manifest placeholder
- `/Users/gordon/work/gno.sh/docs/release-readiness-checklist.md:132` — lifecycle proof

**Optional** (reference as needed):
- Hetzner Object Storage lifecycle documentation
- OWASP File Upload Cheat Sheet

## Key context
A stored object is not visible until the matching snapshot generation is committed. Raw sentinels or partial asset sets fail the whole ingest. Delivery authorization is the next task.

## Acceptance
- [ ] Hostile/malformed assets and unresolved sentinels fail before snapshot/catalog visibility and leave no permanent orphan set.
- [ ] Storage-success/ingest-failure, retry, concurrent publish, republish, delete, and rollback prove idempotent lifecycle and cleanup.
- [ ] Object keys/logs expose no source paths or secret tokens; size/digest/media metadata is accurate.
- [ ] Snapshot/catalog generation can never reference a missing or wrong-generation asset.
- [ ] gno.sh check/typecheck/tests and focused storage/ingest integration pass.

## Done summary
Implemented and verified the bundled raster attachment contract end to end across GNO and gno.sh. The shipped work covers the versioned cross-repo contract, safe local attachment resolution, public/secret/encrypted delivery, transactional ingestion, renderer behavior, documentation, security hardening, and cross-repo release verification.
## Evidence
- Commits: 7129d3f609bf73b37286f253d5f7ea3bad80093a, 0948f4f8d30145e8671407ca4c1a5a1bcc73a9a1, 95163f597a4802b277f4b7f6e36337a12f34bebf
- Tests: bun run prerelease (3907 pass, 2 intentional skips, docs 15/15, package smoke passed), gno.sh bun run check && bun run typecheck && bun run build, cross-repo publish contract and live-site local QA
- PRs: https://github.com/gmickel/gno/pull/176, https://github.com/gmickel/gno.sh/pull/30