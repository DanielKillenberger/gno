# GNO peek command + desktop integration surface

## Conversation Evidence

> user (turn 1): "Interesting idea: check https://omarchyplugins.com/develop.html research the above then consider what a GNO omarchy plugin would look like, perhaps it would show some stats by default and allow browsing, search notes or something, check out other plugins to see what would be maximally useful"
> user (turn 5): "i assume this would be a new repo in additon to the gno and gno.sh repos, right (apart from the changes we do inside of gno)"
> user (turn 5): "and yes btw, i think we should add those helpful commands to gno (gno skill/mcp/cli) that we need for this to be useful"
> user (turn 7): "we want heavy QAing of all of this while devvinig before releasing"

## Goal & Context
<!-- Goal & Context: 55% [user], 30% [paraphrase], 15% [strategy] -->

External integrations — starting with the GNO Recall Omarchy shell plugin
(sibling spec), but equally any status bar, launcher, or desktop tool — need a
cheap, stable way to read GNO's state: index health, counts, backlog, and
recent activity. Today that snapshot requires composing several CLI calls
(`gno status` + `gno ls` + `gno changes`), each a separate subprocess, some of
which can initialize heavyweight machinery. The user's direction: "add those
helpful commands to gno (gno skill/mcp/cli) that we need for this to be
useful". [user]

These additions land inside the existing `gno` repo and ship in a normal gno
release; the plugin that consumes them lives in its own repository (sibling
spec). [user]

Same-contract coherence: the desktop shell consumes the same documented
JSON/CLI contracts as MCP clients and the web UI — no private integration
path. [strategy:coherent-surfaces]

## API Contracts
<!-- API Contracts: 20% [user], 25% [paraphrase], 55% [inferred] -->

**1. `gno peek --json`** — compact status snapshot for external integrations.
One fast invocation, no model/embedding/vector initialization, warm-path
budget < 300 ms (recorded as benchmark evidence at the gate, not a hard
contract test — cold Bun spawn will miss it; the consumer's cache absorbs
that). Follows existing gno CLI JSON conventions: bare payload on success
(no `ok` envelope), the existing `error.schema.json` envelope
(`VALIDATION` exit 1 / `RUNTIME` exit 2) on failure. Uninitialized is a
successful, reportable state — not an error (review consensus: a status
command answering "what state are you in" must not fail when the answer is
"not set up yet"). Output shape (fields shown are the contract):
[paraphrase]

```json
{
  "schemaVersion": "peek@1.0",
  "gnoVersion": "0.42.0",
  "generatedAt": "2026-08-29T09:00:05Z",
  "initialized": true,
  "indexName": "default",
  "counts": { "documents": 1234, "collections": 5 },
  "backlog": { "pending": 0, "failed": 0 },
  "lastIndexedAt": "2026-08-29T09:00:00Z",
  "recent": [
    { "docid": "abc123", "uri": "gno://notes/inbox.md", "title": "Inbox", "collection": "notes", "absPath": "/home/user/notes/inbox.md", "modifiedAt": "2026-08-29T08:55:00Z" }
  ],
  "serve": { "running": true, "url": "http://localhost:3000" }
}
```

Field semantics (pinned): `initialized:false` → `counts`, `backlog`,
`lastIndexedAt` are `null`, `recent` is `[]`, exit 0. `title` is nullable
(consumers fall back to the URI tail). `lastIndexedAt` is nullable on an
initialized-but-never-indexed store. `recent` is bounded (max 10), sorted by
`modifiedAt` descending. `backlog.pending` = documents awaiting embedding
(`status.embeddingBacklog` source); `backlog.failed` = ingest/index errors
(`recentErrors` source) — the bar badge keys off these two meanings, so they
are contract, not implementation detail. `serve` when not running:
`{ "running": false, "url": null }`; liveness via the existing pid-file
mechanism (`process.kill(pid, 0)`, stale pid → `running:false`) — never an
HTTP probe that can hang. Partial-read failure is atomic: any subquery
failure → `RUNTIME` envelope, never a half-filled payload. [paraphrase]

**2. Frozen open/deep-link contract** — two documented mappings:

- **Web UI**: `{serveUrl}/doc?uri=<encodeURIComponent(uri)>` — the route
  already served by `gno serve` (optionally `#anchor` for sections). The
  template is frozen here and documented in the API/Web-UI docs as stable
  across releases; unknown URIs land on the web UI's own not-found handling
  (the link is derived, so there is no CLI-side resolver and no CLI error
  surface). [paraphrase]
- **Source file**: `absPath` on peek `recent[]` items, plus a documented
  source-path field on `gno search --json` results (documented flag or
  default field), so open-file actions never require fetching full document
  content via `gno get`. [paraphrase]

**3. Surface sync** — the snapshot is exposed across all three agent surfaces
per the user's direction ("gno skill/mcp/cli"): `spec/cli.md` updated, output
schema added under `spec/output-schemas/` with a contract test, a read-only
model-free MCP tool exposing the same peek snapshot shape, and
`assets/skill/SKILL.md` pointing agents at peek for status questions. [user]

Consumers rely only on these documented JSON contracts — no scraping of
human-readable output. [inferred]

## Edge Cases & Constraints
<!-- Edge Cases & Constraints: 100% [inferred] -->

- `gno peek` must never trigger model downloads or embedding/vector/LLM
  initialization — it is a read-only metadata query and must stay cheap enough
  for a bar widget to poll. [inferred]
- Serve detection reuses the existing pid-file liveness check
  (`serve --status` mechanism) — never an HTTP probe that can hang the
  300 ms budget. [paraphrase]
- A locked or concurrently-written database yields the existing structured
  `RUNTIME` envelope (exit 2), never a hang or a crash. [inferred]
- The < 300 ms target is a warm-path budget verified by recorded benchmark
  evidence, not a CI-gated hard assertion (cold Bun spawn misses it by
  design; consumers cache). [paraphrase]
- **QA is continuous during development, not a release-time event** ("we
  want heavy QAing of all of this while devving before releasing"): every
  task touching peek, the deep link, the MCP tool, or the skill captures
  live evidence as it lands — real `gno peek --json` output on a real index
  (initialized, uninitialized, empty, serve up/down), a real MCP tool
  invocation, a real browser hit on the frozen `/doc?uri=` link — per the
  repo's live-QA rule that verdicts rest on captured evidence from the
  running app, never on reading source. A full `/flow-next:qa` pass on this
  spec precedes merge. [user]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** `gno peek --json` returns the exact snapshot shape above
  (versioned `peek@1.0`, `gnoVersion`, `generatedAt`, initialized flag with
  pinned null semantics, counts, backlog with pinned pending/failed meanings,
  nullable `lastIndexedAt`, bounded `recent[]` with `docid`/`absPath`, pid-file
  based `serve`) in a single invocation that performs no
  model/embedding/vector initialization; warm-path < 300 ms recorded as
  benchmark evidence. Errors: uninitialized → success payload with
  `initialized:false` + nulls, exit 0; locked/failed DB read → existing
  `RUNTIME` envelope, exit 2; partial subquery failure → atomic `RUNTIME`,
  never a half-filled payload; never triggers model downloads. [paraphrase]
- **R2:** The open/deep-link contract is frozen and documented: web-UI
  template `{serveUrl}/doc?uri=<encodeURIComponent(uri)>` stable across
  releases, and a documented source-path field on `gno search --json`
  results so open actions need no full-content fetch. Errors: no CLI error
  surface — the URL is derived, unknown URIs resolve to the web UI's own
  not-found handling; search source-path absent → consumer falls back to
  the URI tail for display and disables file-open for that row. [paraphrase]
- **R3:** The new surfaces ship per repo conventions: `spec/cli.md` section,
  `peek@1.0` JSON schema in `spec/output-schemas/` with passing contract
  test, a read-only model-free MCP tool exposing the same snapshot shape,
  and skill docs updated — all in the same change. Errors: no error surface
  beyond R1/R2 (conformance enforced by contract tests). [user]

## Boundaries
<!-- Boundaries: 50% [user], 50% [inferred] -->

- No plugin code lands in this repo — the Omarchy plugin lives in its own new
  repository (sibling spec). [user]
- No new write/mutation surface — peek and the deep-link contract are
  read-only. [inferred]
- No daemon/watch mode for peek in v1 — polling by the consumer is the model.
  [inferred]

## Decision Context

- `gno peek` exists because composing the snapshot from `gno status` +
  `gno ls` + `gno changes` costs several subprocess round-trips per refresh;
  one purpose-built read-only command keeps external consumers cheap.
  [inferred]
- Split origin: this spec and "GNO Recall — Omarchy shell plugin" were
  captured from one conversation designing the Omarchy plugin; this spec is
  the gno-side dependency the plugin builds on. The plugin spec depends on
  this one. [paraphrase]
- Review amendments (Grok 4.6 + GPT-5.6 Sol, both HAPPY-WITH-CHANGES,
  folded in at the user's direction): dropped the invented `{ok:…}` envelope
  and `NOT_INITIALIZED` error in favor of existing CLI conventions
  (uninitialized = successful state, `RUNTIME`/exit 2 for real failures);
  froze the `/doc?uri=` deep-link template instead of deferring it; added
  `schemaVersion`/`gnoVersion`/`absPath`/`docid` and pinned backlog/null
  semantics; serve liveness via pid-file, not HTTP; 300 ms demoted to a
  benchmarked warm-path budget. [paraphrase]

## Strategy Alignment

- Coherent agent and application surfaces: these contracts serve the desktop
  shell, MCP clients, agents (skill), and any future integration through one
  documented path. [strategy:coherent-surfaces]

## Requirement coverage

| R-ID | Task |
|------|------|
| R1 | fn-119-gno-peek-command-desktop-integration.1 |
| R2 | fn-119-gno-peek-command-desktop-integration.2 |
| R3 | fn-119-gno-peek-command-desktop-integration.3, fn-119-gno-peek-command-desktop-integration.4 |
