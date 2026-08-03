---
satisfies: [R1, R3, R4, R5]
---

# fn-71-bundled-image-attachments-in-publish-export.1 Freeze cross-repo asset contract threat model and fixtures
## Description
Define the executable producer/consumer contract before implementation: optional raster asset schema, capability negotiation, sentinel grammar, exact envelope-size accounting, visibility classes, integrity checks, lifecycle terminals, and hostile fixtures shared by gno and gno.sh.

**Size:** M
**Files:** `spec/output-schemas/publish-artifact.schema.json`, `src/publish/artifact.ts`, `test/publish/fixtures/`, `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts`, `/Users/gordon/work/gno.sh/docs/handoffs/gno-publish-artifact-contract.md`, `/Users/gordon/work/gno.sh/test/fixtures/`

## Approach
- Preserve asset-free artifact behavior and make required capabilities explicit.
- Compute limits from final serialized bytes, not raw-asset estimates.
- Model public, secret, and encrypted delivery separately in the threat model.
- Create cross-repo fixtures for valid/invalid v1/v2 and old/new producer-consumer combinations.

## Investigation targets
**Required** (read before coding):
- `src/publish/artifact.ts:36-42` — current producer note shape
- `src/publish/encrypted-export.ts:50-52,193` — current encrypted envelope placeholders
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts:47-98,211-228` — current consumer shape/empty manifest
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact-client.ts:11` — 100 MiB external cap
- `/Users/gordon/work/gno.sh/docs/handoffs/gno-publish-artifact-contract.md:10-49` — contract owner

**Optional** (reference as needed):
- `/Users/gordon/work/gno.sh/docs/prd/publish-artifact-upload.md:80` — current asset exclusion
- `spec/cli.md:1947` — public HTTP(S) image metadata distinction

## Key context
Raw `gno-asset:` sentinels must never reach rendered HTML. “Secret” is an authorization boundary; presigned/public object URLs do not replace the share capability. SVG is unsupported in this release.

## Acceptance
- [ ] Both repos validate the same asset/capability fixtures and old asset-free artifacts remain accepted.
- [ ] Contract specifies exact serialized-byte accounting, supported raster signatures, digest/length/dimension checks, and deterministic diagnostics.
- [ ] Public, secret, and encrypted delivery/egress boundaries plus rollback/delete/idempotency terminals are explicit.
- [ ] Missing/conflicting assets, raw sentinels, traversal, MIME spoofing, oversize, corruption, and unsupported capabilities fail closed in fixtures.
- [ ] Focused schema/fixture tests and both repos' lint/type checks pass.

## Done summary
Implemented and verified the bundled raster attachment contract end to end across GNO and gno.sh. The shipped work covers the versioned cross-repo contract, safe local attachment resolution, public/secret/encrypted delivery, transactional ingestion, renderer behavior, documentation, security hardening, and cross-repo release verification.
## Evidence
- Commits: 7129d3f609bf73b37286f253d5f7ea3bad80093a, 0948f4f8d30145e8671407ca4c1a5a1bcc73a9a1, 95163f597a4802b277f4b7f6e36337a12f34bebf
- Tests: bun run prerelease (3907 pass, 2 intentional skips, docs 15/15, package smoke passed), gno.sh bun run check && bun run typecheck && bun run build, cross-repo publish contract and live-site local QA
- PRs: https://github.com/gmickel/gno/pull/176, https://github.com/gmickel/gno.sh/pull/30