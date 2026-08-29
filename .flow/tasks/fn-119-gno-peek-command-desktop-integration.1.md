---
satisfies: [R1]
---
# fn-119-gno-peek-command-desktop-integration.1 Implement gno peek --json snapshot

## Description
Ship `gno peek --json` per spec R1: one cheap metadata snapshot (`peek@1.0`) with pinned null/backlog/serve semantics. Split here so the CLI contract and shared builder exist before MCP, docs, and deep-link QA consume them.

**Size:** M
**Files:** spec/cli.md; spec/output-schemas/peek.schema.json; test/spec/schemas/peek.test.ts; test/spec/schemas/validator.ts; src/core/peek.ts; src/cli/commands/peek.ts; src/cli/program.ts; src/cli/options.ts; test/cli/peek.test.ts
**Touches:** spec/cli.md; spec/output-schemas/peek.schema.json; test/spec/schemas/; src/core/peek.ts; src/cli/commands/peek.ts; src/cli/program.ts; src/cli/options.ts; test/cli/peek.test.ts

### Approach
- Spec-first: add `### gno peek` next to `### gno status` in `spec/cli.md` (~215). Add `peek` to the output-format matrix (~65) as `--json` yes, default terminal. JSON = bare payload (no `ok` envelope). Errors reuse `error.schema.json` (`VALIDATION` exit 1 / `RUNTIME` exit 2).
- Add `spec/output-schemas/peek.schema.json` with `$id` `gno://schemas/peek@1.0`. Register the name in `test/spec/schemas/validator.ts` `schemaFiles` (~15). Contract-test initialized, `initialized:false` + nulls, serve up/down, and reject extra/half-filled fields — follow `test/spec/schemas/status.test.ts`.
- Extract a shared builder `src/core/peek.ts` (CLI + later MCP). Do **not** call `initStore` (`src/cli/commands/shared.ts:57`) or copy `status()` (`src/cli/commands/status.ts:226`) — those treat uninitialized as failure and pull ModelCache/activation.
- Uninitialized: `isInitialized` (`src/config/loader.ts:165`) false → success payload, `initialized:false`, `counts`/`backlog`/`lastIndexedAt` null, `recent` `[]`, `serve` not-running, exit 0.
- Initialized: `SqliteAdapter.open` + `getStatus()` with **no** `embedModel` (`src/store/sqlite/adapter.ts:5473`). Map `activeDocuments` → `counts.documents`, collection count → `counts.collections`, `embeddingBacklog` → `backlog.pending`, `recentErrors` → `backlog.failed`, `lastUpdatedAt` → `lastIndexedAt`. Any subquery failure → one `CliError("RUNTIME", …)` (`src/cli/errors.ts`); never emit a partial object.
- `recent`: `listDocumentsPaginated` (`src/store/sqlite/adapter.ts:2000`) `limit: 10`, default `sortOrder` DESC on `source_mtime` (~2097). Map `docid`/`uri`/`title`/`collection`/`sourceMtime` → `modifiedAt`; `absPath` = collection root + `relPath` (same join as `src/pipeline/search.ts:102`). `title` nullable. Cap 10.
- `serve`: `resolveProcessPaths("serve")` + `readPidFile` + `isProcessAlive` (`src/cli/detach.ts:114`, `:154`, `:376`). If live and `payload.port` set → `{ running: true, url: "http://localhost:${port}" }` (same host string as `src/cli/program.ts:4420`). Else `{ running: false, url: null }`. **Do not** call `statusProcess()` — it HTTP-fetches resident status (`src/cli/detach.ts:814`).
- Wire like status: `CMD.peek` in `src/cli/options.ts:60`, register beside status in `src/cli/program.ts:1654` (lazy import). `schemaVersion` const `peek@1.0`; `gnoVersion` from `VERSION` (`src/app/constants.ts:30`); `generatedAt` RFC 3339 UTC.
- Tests: `test/cli/peek.test.ts` via `runCli` (`src/cli/run.ts`) like `test/cli/status.test.ts`. Assert no model/embed/vector init (builder never touches `ModelCache` / `resolveModelUri` / activation).

### Investigation targets
**Required** (read before coding):
- `.flow/specs/fn-119-gno-peek-command-desktop-integration.md`
- `src/cli/program.ts`
- `src/cli/commands/status.ts`
- `src/cli/detach.ts`
- `spec/cli.md`
- `spec/output-schemas/status.schema.json`
- `src/store/sqlite/adapter.ts`
**Optional**:
- `src/cli/commands/shared.ts`
- `spec/output-schemas/error.schema.json`
- `spec/output-schemas/process-status.schema.json`
- `test/spec/schemas/status.test.ts`
- `src/config/loader.ts`

### Key context
`gno status` exits 2 when uninitialized; peek must exit 0 with `initialized:false`. `status.embeddingBacklog` is a chunk count in `status.schema.json` but R1 names that field as `backlog.pending` (do not invent a second query). Spec example `docid` lacks `#`; store/search docids are `#` + hex — emit the store `docid` as-is and pin that in the peek schema. Warm-path < 300 ms is recorded benchmark evidence only, not a CI assertion.

## Acceptance
- [ ] `gno peek --json` matches `peek@1.0` (schema + contract tests) and performs no model/embedding/vector initialization.
- [ ] Uninitialized → exit 0, `initialized:false`, null counts/backlog/`lastIndexedAt`, `recent: []`.
- [ ] Locked/failed DB or partial subquery → `RUNTIME` envelope, exit 2; never a half-filled payload.
- [ ] Live evidence captured on a real index: uninitialized, initialized-empty, initialized-with-docs, serve down, serve up (pid-file liveness; stale pid → `running:false`). Save raw JSON + exit codes. Record a warm-path timing note (not a failing assertion).

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
