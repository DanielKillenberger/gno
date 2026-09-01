## Goal & Context

Ship the memory slice: `remember`/`recall` as universal core contracts on all four surfaces (CLI, MCP, REST, SDK), so any agent or operator can store facts and get budgeted, cited, current-state recall from a local markdown memory collection. This is the "contend for agent memory" decision from the strategy note (vault: GNO Competitive Gap Analysis 2026-09, "Memory architecture direction (decided)"), architecture converged by two independent design memos.

The write-path taxonomy this slice must keep coherent (validated in the reference deployment's writing contract): **edit** updates an existing canonical note (file edit, outside GNO's API), **capture** creates a genuinely new document (existing primitive), **remember** upserts a FACT with supersession semantics (new). Remember is not a second capture; it is fact-granular with current-state reduction.

## Architecture & Data Models

- **Memory substrate (L0):** one fact per markdown file in a memory collection. Frontmatter carries: record ID, explicit scope list, source client + session identity, timestamps, and supersession expressed as the existing typed-edge mechanism (`relations: supersedes: [gno://...]` projected into `doc_edges` — reuse, do not build a new store). Files are canonical; SQLite stays derived. A collection config flag declares `gno_managed` write mode; `remember` refuses to write into collections without it.
- **Memory service (L1):** transport-neutral core module (same pattern as `src/core/capture.ts`) implementing `remember()` and `recall()`. All four surface bindings are thin adapters over it.
- **Scope enforcement is core correctness code:** every remember/recall call names explicit scopes; unscoped calls fail validation with a clear message. No implicit global scope. Shared scope is opt-in configuration, not default behavior. Scope semantics (binding): 1..8 normalized scopes per fact (trim/lowercase/NFC/dedupe); visibility = any-intersection with the caller's explicit list; filtering executes inside the retrieval query (post-filtering a bounded candidate window is forbidden — false-empty recall). Scope persistence requires store-level support (indexed, filterable), owned by the core task. The collection flag is `memoryManaged` in CollectionSchema (schema strips unknown keys today — the field must be added properly). Lease ownership: the core service acquires the shared write lease for every write; surface adapters never do.

## API Contracts

**remember** (CLI `gno remember`, MCP `gno_remember` behind the existing write flag, REST `POST /api/memory/remember`, SDK `client.remember()`):
- Input: fact text; collection; explicit scope(s); caller + session identity; OPTIONAL decision `add` | `supersede` (absent → candidate-proposal path, writes nothing); for supersede: predecessor URI + content hash; optional recall receipt, `derivedFrom` origin declarations, and source evidence.
- Behavior: search current same-scope memories for candidates. Exact duplicate → return existing record idempotently. Likely match WITHOUT an explicit decision → return candidates, write nothing (no LLM adjudication in v1; the caller decides). `add` → new fact file. `supersede` → verify predecessor identity+hash, check no existing successor (under the shared write lease; concurrent supersede returns a conflict, never two current branches), create successor with the `supersedes` relation. Write + lexical sync complete under the lease before success (fact is immediately retrievable).
- **Context fencing:** recall responses include a content-free receipt (caller, session, memory IDs, span hashes). `remember` rejects input that exactly replays receipted spans or declares GNO-derived origin. Docs state plainly that paraphrases without lineage cannot be fenced.

**recall** (CLI `gno recall`, MCP `gno_recall` in the read set, REST `POST /api/memory/recall`, SDK `client.recall()`):
- Input: query; explicit scope(s); optional budget overrides.
- Behavior: hybrid retrieval over the memory collection with expansion, graph expansion, and reranking disabled (fast path); superseded records excluded; at most 8 facts under a 512-token payload by default (reuse the existing context-budget selection); each fact carries text, scope, provenance, `gno://` URI, hashes; response includes the fencing receipt. Empty result returns the self-teaching line naming `gno remember` (all surfaces).
- MCP tool descriptions for both tools are first-class deliverables written as micro-instructions (when to call, what comes back), reviewed against the copy rules.

## Edge Cases & Constraints

- Egress: memory collections carry per-collection egress policy like any collection; derived recall output inherits the strictest source.
- Malformed hand-edited memory files: excluded from managed recall, surfaced via status/audit; ordinary document retrieval still sees them.
- A new memory is "current" only after write + lexical sync succeed; receipts expose pending/failed state (synced-vault lag honesty).
- Concurrency: all writes under the v1.38.0 shared write lease.
- The four-surface rule is hard: one shared schema, cross-surface contract tests (spec/output-schemas + test/spec/schemas per repo convention).

## Acceptance Criteria

- R1: `remember` with `add` creates a fact file with the full frontmatter contract in a `gno_managed` collection and it is lexically retrievable before the command returns success. Verified live on CLI and MCP; REST and SDK by contract test.
- R2: `remember` with `supersede` requires predecessor URI + hash; the successor carries the `supersedes` relation; a concurrent second supersede of the same predecessor returns a conflict. Verified live with two racing writers.
- R3: A likely-match `remember` without a decision returns candidates and writes nothing.
- R4: Unscoped remember/recall calls fail validation on every surface; scoped calls against a non-`gno_managed` collection fail with a clear message.
- R5: `recall` returns only current facts (superseded excluded), respects the 8-fact/512-token default budget, includes `gno://` cites and a fencing receipt; empty recall returns the self-teaching line. Verified live on CLI and MCP.
- R6: The fence loop test: recall a fact, attempt to remember the recalled span with the receipt attached → rejected. Verified live.
- R7: One shared schema across CLI/MCP/REST/SDK with contract tests; spec/cli.md, spec/mcp.md, docs (CLI.md, MCP.md, API.md, and a new docs/MEMORY.md) updated in the same change; MCP tool descriptions meet the copy rules.
- R8: Exclusions hold: no automatic turn capture, no LLM extraction/adjudication, no consolidation, no delete/forget, no memory web UI, no implicit global scope, no cross-machine coordination, no harness adapters.

## Boundaries

- Out: harness adapters (OpenClaw backend, Hermes provider) — separate follow-up after fleet dogfooding.
- Out: entity extraction, temporal queries beyond supersession filtering.
- Out: consolidation/dedup jobs (later, operator-gated, findings-only).
- Out: any change to capture semantics (capture stays the creation primitive; this spec must not blur the taxonomy).

## Pilot routing

plan (pre-planned, SHIP) — dispatch the work stage via `/flow-next:work-rolling <this-id> mode:autonomous` (task graph fans out after .1; rolling per-task admission).
