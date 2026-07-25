---
satisfies: [R1, R2, R3, R4, R5, R6, R7, R8]
---
# fn-111-collection-egress-policies.6 Prove migration adversarial enforcement and public security docs

## Description
Deliver prove migration adversarial enforcement and public security docs as one implementation-sized increment.

**Size:** M
**Files:** `test/egress`, `test/traces/cross-surface.test.ts`, `test/mcp/http-security.test.ts`, `test/publish`, `docs/CONFIGURATION.md`, `docs/MCP.md`, `docs/PUBLISHING.md`, `assets/skill/SKILL.md`, `/Users/gordon/work/gno.sh/src/routes/privacy.tsx`

### Approach
- Test legacy collections, existing public artifacts, queued jobs, sessions, one-shot local/remote confirmations, mixed sources, DNS/redirect/proxy/VPN/rebinding, audit purge, and rollback across package/platform fixtures.
- Document migration friction and irreversibility: old public content may require remote takedown; future publish/remote inference is denied until explicit policy.
- Update DB/spec/schemas/repo/skill/gno.sh privacy/publish/acceptable-use/pricing surfaces and run prerelease/package/security/deploy verification.
- Add adversarial trace-export coverage proving the two independent gates: authenticated-but-write-disabled MCP callers cannot mutate/export, write-enabled callers remain blocked by restrictive destination policy, and same-origin loopback REST mutations do not authorize non-loopback egress. Denials and missing IDs leak no query, goal, local path, target reference, or trace content.
- Lock compatibility with the task-3 closed management schemas and store semantics: opaque pagination, bounded-detail totals/truncation, explicit-label-only judgments, atomic aggregate manifest membership, exact cascade counts, and `completed` / `wal_busy` / `failed` physical purge receipts. Policy migration may add lineage fields only through an explicit schema version/update; it may not silently change those meanings.

### Investigation targets
**Required** (read before coding):
- `spec/db/schema.sql`
- `docs/CONFIGURATION.md`
- `docs/MCP.md`
- `assets/skill/SKILL.md`
- `/Users/gordon/work/gno.sh/src/routes/privacy.tsx`

**Optional** (reference as needed):
- `docs/DAEMON.md`

**Planned dependency outputs** (expected by execution; not plan-time investigation sources):
- `test/egress`

## Acceptance
- [ ] All adversarial destination/auth/mixed/derived/migration/session/job/audit cases fail closed or disclose explicit partial behavior.
- [ ] Existing local retrieval/indexing survives migration; blocked network actions explain exact safe remediation.
- [ ] Specs/schemas/docs/skill/gno.sh retain deferred-private and never-server-decrypt boundaries, and full verification/deploy gates pass.
- [ ] Security regressions prove write authorization and destination policy are both required for trace export, while local inspect/delete/full purge remain available and truthful without content leakage.

<!-- Updated by plan-sync (cross-spec): fn-100-private-retrieval-learning-loop.3 established the trace authorization, schema, aggregate-manifest, and purge regression baseline -->


## Done summary
Completed the adversarial security, migration, and public-contract proof for collection egress policies. Added v12-to-current migration coverage proving legacy collections retain lexical retrieval and indexed state while receiving fail-closed `legacy_default` policy provenance. Expanded cross-surface trace tests to prove authentication, write authorization, and collection destination policy remain independent gates; denied MCP and REST exports expose no query, path, URI, target, or trace content and create no aggregate manifest, while local loopback inspection, delete, and physical purge remain available and truthful.

Documented the complete `local_only` / `lan` / `remote` contract, revision-bound relaxation, immediate tightening invalidation, mixed-evidence restriction, explicit partial behavior, content-free audit receipts, migration friction, remote takedown responsibility, and client-encrypted never-server-decrypt boundary across repo docs, DB specification, agent skill, README, changelog, and hosted gno.sh configuration/privacy/publish/legal/pricing surfaces. Added hosted public-truth regression tests so those claims cannot silently drift.

Verified the entire GNO and gno.sh surfaces. GNO lint, typecheck, 3,448-test suite, docs verifier, clipper reproducibility, packed-package smoke, and real-store integrity sentinel passed. The focused egress/security/migration lane passed 123 tests. The agent skill benchmark stayed at 47/47. gno.sh formatting, lint, typecheck, 112-test suite, production build, and 68-page prerender passed.
## Evidence
- Commits: d152799b, gno.sh 96995e0, gno.sh 0b473f7
- Tests: focused egress/security/migration: 123 pass, 0 fail, 1042 assertions, bun run lint:check, bun run typecheck, bun test: 3448 pass, 2 expected skips, 0 fail, 26716 assertions, bun run docs:verify: 13 pass, 0 fail, 2 model-cache skips, bun run verify:clipper-package: reproducible SHA-256 5cdb85ddd0e73801a566527b7a908c8e0854a83c56cae281bab5f1285dae6734, bun run test:package: passed; real GNO store sentinel unchanged, autoresearch-gno-skill eval.py: 47/47, 100%, gno.sh bun run check + typecheck + bun test: 112 pass, 7 expected integration skips, 0 fail, gno.sh production build: 68 pages prerendered
- PRs: