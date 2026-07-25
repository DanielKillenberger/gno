---
satisfies: [R1, R5, R6, R8]
---
# fn-111-collection-egress-policies.5 Expose policy configuration checks and denials across surfaces

## Description
Deliver expose policy configuration checks and denials across surfaces as one implementation-sized increment.

**Size:** M
**Files:** `src/core/retrieval-trace-management.ts`, `src/cli/commands/collection/policy.ts`, `src/serve/routes/api.ts`, `src/serve/routes/traces.ts`, `src/mcp/tools/status.ts`, `src/mcp/tools/trace.ts`, `src/sdk/client.ts`, `src/serve/public/components/CollectionModelDialog.tsx`, `spec/output-schemas`

### Approach
- Add collection policy get/set/check and explain-egress paths using guarded config mutation, diff, and explicit confirmation for relaxations.
- Expose effective/source policy, decision/reason, partial semantics, and audit controls consistently in CLI/REST/MCP/SDK/Web/Desktop without content leakage.
- Invalidate resident sessions/caches/queued jobs when a policy tightens; re-evaluate at execution time, not enqueue time.
- Gate trace artifact egress at the shared `RetrievalTraceManagementService.export` boundary (or one policy-aware wrapper directly composed by it), preserving `RetrievalTraceExportRequest` / `RetrievalTraceExportResult` and the closed export schema. Local inspection, explicit labels, deletion, and purge remain locally usable and do not become egress operations.
- Keep authorization dimensions orthogonal: bearer gateway authentication identifies a caller but still never enables trace label/export/delete/purge; HTTP MCP trace mutation requires the existing explicit `gateway.enableWrite` / `--mcp-enable-write` control; collection egress policy then independently decides whether an authorized export may target local, LAN, or remote destinations. Denials expose stable content-free policy codes.
- Preserve task-3 surface behavior while adding policy fields: newest-first opaque list pagination, bounded show totals/truncation, append-only explicit labels, aggregate manifest identity, missing-trace `NOT_FOUND`, and physical purge cleanup status all remain unchanged.

### Investigation targets
**Required** (read before coding):
- `src/cli/commands/collection`
- `src/core/config-mutation.ts`
- `src/serve/routes/api.ts`
- `src/sdk/client.ts`
- `src/mcp/tools/status.ts`

**Optional** (reference as needed):
- `src/serve/public/pages/Collections.tsx`
## Acceptance
- [ ] All surfaces share policy values, effective source, stable reason codes, explicit partial semantics, and audit controls.
- [ ] Policy relaxation requires visible explicit action; tightening invalidates/rechecks sessions, caches, and queued transfers.
- [ ] Blocked actions remain locally usable where allowed and return actionable remediation without sensitive data.
- [ ] Policy checks never substitute for trace write authorization, never disable local trace inspection/purge, and never mutate or partially reuse an aggregate export manifest after an egress denial.

<!-- Updated by plan-sync (cross-spec): fn-100-private-retrieval-learning-loop.3 froze trace surface schemas, write authorization, aggregate exports, and local purge behavior -->


## Done summary
Hardened collection egress policy management across CLI, REST, MCP, SDK, Web/Desktop, and persisted SQLite state. Relaxation confirmations now bind collection, current policy, durable monotonic revision, and target policy; replayed, stale, cross-collection, cross-target, and concurrent reuse fail closed. All runtime entry points share getter-safe closed validation, REST bodies are byte-bounded before buffering, and invalid input causes no config, store, audit, session, or job mutation.

Trace export identity now binds the current policy lineage while preserving immutable historical trace provenance. Resident authorization epochs guard delayed and streaming REST/MCP responses; the mutating MCP request advances to the new epoch while older active responses emit only a content-free retry result. Policy session invalidation rejects new requests immediately and defers closing active sessions until their response finishes.

Added Web/Desktop policy explain controls and newest-first audit receipt inspection, exact show, confirmed delete/purge, opaque pagination, and truthful SQLite cleanup results. Updated schemas, migration 25, CLI/MCP/API/Web documentation, and regression coverage.
## Evidence
- Commits: f0799c9b
- Tests: bun run lint:check, bun run typecheck, bun test (3443 pass, 2 expected skips, 0 fail), bun run docs:verify (13 pass, 0 fail, 2 model-cache skips), bun run verify:clipper-package, bun run test:package, autoresearch-gno-skill eval.py (47/47, 100%), .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json
- PRs:
