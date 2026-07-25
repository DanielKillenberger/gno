---
satisfies: [R1, R2, R3, R4, R5, R6, R7]
---
# fn-110-file-and-export-first-source-adapters.6 Complete record metadata parity security packaging and support docs

## Description
Deliver complete record metadata parity security packaging and support docs as one implementation-sized increment.

**Size:** M
**Files:** `src/pipeline/types.ts`, `src/core/context-evidence.ts`, `src/app/context-format.ts`, `spec/output-schemas`, `test/ingestion/export-adapters-e2e.test.ts`, `docs/guides/file-export-adapters.md`, `assets/skill/SKILL.md`, `/Users/gordon/work/gno.sh/src/lib/gno-docs.tsx`

### Approach
- Preserve record-level people/dates/source locators and exact transcript/message/event anchors through search/get/Ask/Capsule without leaking unsafe absolute paths; extend task 3's `ContextEvidenceValue` and `toContextCapsuleEvidence` projection (plus the versioned schema) for approved record metadata rather than bypassing `compileContextEvidence`. Keep `formatContextCapsuleMarkdown` complete and trust-safe for the added fields: exact passage bytes remain untouched, untrusted metadata remains JSON-escaped/bounded, and the canonical manifest retains every schema field.
- Run streaming/memory, sanitization, encoding, MIME, timezone, duplicate/missing ID, partial snapshot, cross-platform, and packed npm suites.
- Publish a precise support matrix, config/limits/retry/quarantine guidance, and no-live-account/no-OAuth boundary across repo/skill/hosted docs.

### Investigation targets
**Required** (read before coding):
- `src/pipeline/types.ts`
- `spec/output-schemas`
- `docs/CONFIGURATION.md`
- `assets/skill/SKILL.md`

**Optional** (reference as needed):
- `docs/API.md`
- `docs/SDK.md`

**Planned dependency outputs** (expected by execution; not plan-time investigation sources):
- `src/core/context-evidence.ts`

## Acceptance
- [ ] Cross-surface fixtures retain useful record metadata and exact anchors with schema parity.
- [ ] All resource/security/privacy/idempotency/cross-platform/package regression suites pass.
- [ ] CLI/config/docs/skill/gno.sh support matrices distinguish exports from live connectors and state caps/identity/tombstone/attachment behavior accurately.
- [ ] Record metadata additions preserve `compileContextEvidence` snapshot/provenance validation, exact full-line coordinates, and cross-surface canonical projection parity.
<!-- Updated by plan-sync (cross-spec): fn-98-context-capsule-mvp.3 made ContextEvidenceValue and toContextCapsuleEvidence the canonical evidence projection seam -->
<!-- Updated by plan-sync (cross-spec): fn-98-context-capsule-mvp.5 review fixes made complete trust-bounded Markdown part of Capsule schema parity -->


## Done summary
Completed portable export-record integration across storage, retrieval, CLI, SDK, MCP, REST, Ask, Context Capsules, project profiles, packaging, and documentation. Logical records retain stable source lineage, bounded metadata and exact anchors while remaining read-only projections of their source containers. Added atomic snapshot reconciliation, safe partial/authoritative tombstone semantics, deterministic timezone handling, canonical adapter fingerprints, logical-source filtering/context parity across BM25/vector/hybrid/graph, live-browser-profile and symlink denial, global control-character sanitization, closed output schemas, packed-package coverage, hosted documentation, and refreshed deterministic benchmark/demo artifacts. Completion remediation now preserves same-Message-ID variants, projects mail-chain and attachment hashes, emits deterministic bounded per-record reconciliation receipts, surfaces zero-failure partial snapshots, and uses linear bounded HTML/entity sanitization with a two-million-character regression.
## Evidence
- Commits: 869b40df, ec8a27bd, 70cba6fe, 28138a00, 52e318dc, e0acbd55
- Tests: bun run lint:check (0 warnings/errors; formatting clean), bun test (3339 pass, 2 expected skips, 0 fail), bun run docs:verify (13 pass, 2 model-cache skips), bun run test:package (packed npm smoke passed; real-user sentinel unchanged), bun run eval:agentic -- --write (144/144 scored; Capsule promotion passed), gno skill evaluator (47/47, 100%), gno.sh ultracite/typecheck/test/build (111 pass, 7 skipped; 68 routes prerendered), independent completion remediation audit (SHIP)
- PRs: https://github.com/gmickel/gno/pull/154, https://github.com/gmickel/gno.sh/pull/21