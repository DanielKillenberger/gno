---
satisfies: [R1, R2, R3, R4, R6]
---
# fn-130-memory-slice-rememberrecall-contracts.1 Core memory service: substrate + remember/recall engine

## Description
L0+L1 in one transport-neutral core module (pattern: src/core/capture.ts).
**Size:** L. **Files/Touches:** new src/core/memory*.ts; src/config/types.ts (CollectionSchema gains `memoryManaged: boolean` — schema currently strips unknown keys, so the field must be added properly + config docs); src/store (scope persistence: scopes stored as indexed metadata filterable AT RETRIEVAL TIME — migration + store-port change as needed; post-filtering a bounded candidate window is FORBIDDEN because it yields false-empty recall); src/ingestion (supersedes projection hookup); test/core/memory*.
**Contract decisions (from plan review, binding):**
- `decision` is OPTIONAL tri-state: absent → candidate-proposal path (writes nothing, returns candidates — the R3 branch); `add`; `supersede` (requires predecessor URI + content hash).
- Scope model: each fact carries 1..8 scopes; normalization = trim, lowercase, NFC, dedupe; matching = any-intersection between the caller's explicit scope list and the fact's scopes; scope filtering happens inside the retrieval query, never post-hoc.
- Lease ownership: the CORE service acquires the shared write lease internally for every write path; adapters (CLI/MCP/REST/SDK) MUST NOT take the lease or ctx.writeLockPath themselves — single acquisition point, no nesting.
- Malformed managed-memory files: a validator (diagnostic codes) excludes them from managed recall and projects the diagnostics through the EXISTING status/audit surfaces (gno status memory section + a gno audit memory check — those implementation files are in this task's Touches); ordinary document retrieval still sees the file.
- Fence: rejection covers (a) spans hash-matching a presented recall receipt and (b) inputs explicitly declaring `derivedFrom` gno:// origins; paraphrases without lineage are documented as unfenceable.
- Candidate-match determinism (binding defaults, tunable in-task with doc): candidate pool = BM25 top-16 within the scope intersection; exact-dup = normalized-text (trim/collapse-ws/NFC) hash equality; likely-match = cosine >= 0.83 when semantic is ready, else lexical likely-match = normalized-token Jaccard similarity >= 0.5 between the incoming fact and the candidate (deterministic, corpus-independent); ordering by score desc, ties by record id; semantic-unavailable degrades to lexical-only and says so in the proposal payload; a fixed-corpus contract test pins the behavior. remember(): candidate match per the above; idempotent exact-dup; supersede conflict check (no existing successor) under the lease; write + lexical sync before success. recall(): hybrid fast path (expansion/graph/rerank off); superseded exclusion executes IN-QUERY (join/anti-join against incoming supersedes doc_edges BEFORE candidate limiting — post-filtering forbidden, same rationale as scopes); recall input REQUIRES caller+session identity (receipts bind to them) on every surface; 8-fact/512-token budget via existing context-budget, gno:// cites carrying egressLineage (recall output inherits the strictest source policy exactly like other retrieval results — the shared schema REQUIRES the lineage field), fencing receipt.

**Touches:** src/core/memory*.ts (new), src/config/types.ts, src/store/** (scope+supersedes retrieval filters, migration), src/ingestion/sync.ts, src/cli/commands/status.ts + src/core audit check modules (malformed-memory diagnostics projection), egress-lineage plumbing for recall results, test/core/memory*

## Acceptance
- [ ] `memoryManaged` collection flag parses, persists, and gates remember (refusal message on unmanaged collections)
- [ ] Scope normalization + any-intersection matching unit-tested incl. multi-scope facts and empty-intersection exclusion; retrieval-level filtering proven (a fact outside the requested scopes never occupies the candidate window)
- [ ] decision tri-state: absent→candidates+no write; add→new fact; supersede→successor with relation; racing supersedes → exactly one current + one conflict (live two-writer test)
- [ ] Core acquires the lease exactly once per write; a probe adapter that pre-holds the lease deadlocks/fails fast with a clear error (test documents the no-nesting contract)
- [ ] Fence rejects receipted replay AND derivedFrom-declared input; paraphrase limitation stated in code docs
- [ ] Write+lexical-sync-before-success proven: fact retrievable immediately after remember returns

- [ ] Superseded exclusion proven in-query (a window full of superseded facts still yields current facts)
- [ ] Malformed-file validator: diagnostic codes, audit/status projection, managed-recall exclusion tested
- [ ] Candidate-match determinism contract test green on the fixed corpus (two runs byte-identical), covering BOTH semantic (cosine 0.83) and lexical-fallback (Jaccard 0.5) modes
- [ ] Malformed-memory diagnostics visible in gno status and gno audit output (live)
- [ ] Recall results carry egressLineage; a local_only-sourced fact marks the recall payload accordingly (test)

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
