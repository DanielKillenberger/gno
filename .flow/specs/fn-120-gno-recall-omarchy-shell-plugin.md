# GNO Recall — Omarchy shell plugin

## Conversation Evidence

> user (turn 1): "Interesting idea: check https://omarchyplugins.com/develop.html research the above then consider what a GNO omarchy plugin would look like, perhaps it would show some stats by default and allow browsing, search notes or something, check out other plugins to see what would be maximally useful"
> user (turn 1): "i want you to do the research on omarchy plugins, how they work, what is supported etc and then pass that research into 3 subagents, 1 gpt-5.6 sol, 1 grok 4.6 and one fable 5. these 3 subagents should all consider what a perfect gno omarchy plugin would do and look like, then we will synthesize"
> user (turn 2): "synthesize, is their common ground?"
> user (turn 3): "super G seems to already do something in omarchy, so we should probably consider the keybinding well"
> user (turn 3): "so basically, recall and quick browse of our notes etc? sounds amazing"
> user (turn 4): "yes, it should have a configurable keybind probably. ok, capture a spec that has all of this, then have grok and gpt-5.6 sol look over it to see if they are happy with the direction and what we plan to do"
> user (turn 4): "the spec should also include the actual publishing of the thing but after we've fully tested it locally as a manual task before publishing"
> user (turn 5): "i assume this would be a new repo in additon to the gno and gno.sh repos, right (apart from the changes we do inside of gno)"
> user (turn 6): "maybe we can find a free one and use that by default, helpful for users" (on the keybinding; SUPER+R verified free against Omarchy Quattro defaults and chosen as the default)
> user (turn 7): "we want heavy QAing of all of this while devvinig before releasing"

## Goal & Context
<!-- Goal & Context: 60% [user], 25% [paraphrase], 15% [strategy] -->

GNO indexes a user's local notes, docs, and knowledge, but reaching it currently
requires a terminal, an agent, or the web UI. On Omarchy (Hyprland + Quickshell
desktops), the shell plugin system makes GNO summonable from anywhere: a quiet
bar presence showing index health, and a keyboard-first overlay for **recall and
quick browse** of notes — the user's framing: "recall and quick browse of our
notes etc? sounds amazing". [user]

The plugin (working name **GNO Recall**) was designed by synthesizing three
independent proposals (GPT-5.6 Sol, Grok 4.6, Fable 5) grounded in research on
the Omarchy plugin system (manifest.json contract, QML/Quickshell runtime,
`omarchy plugin add/validate`, first-party and community plugin patterns). All
three converged on the same product thesis: a low-noise bar widget + summonable
search overlay, backed by GNO's JSON-emitting CLI. [paraphrase]

The plugin lives in a **new public repository**, separate from `gno` and
`gno.sh`. The gno-side contracts it consumes (`gno peek`, the open/deep-link
contract) are delivered by the sibling spec "GNO peek command + desktop
integration surface", which this spec depends on. [user]

The desktop shell consumes the same documented JSON/CLI contracts as MCP
clients and the web UI — no private integration path.
[strategy:coherent-surfaces]

## Architecture & Data Models
<!-- Architecture & Data Models: 80% [inferred], 20% [paraphrase] -->

Two-layer design, consensus across all three proposals: [paraphrase]

- **Thin QML frontend** (bar widget, panel, overlay) owning presentation and
  interaction only. No business logic in QML beyond state display and input
  handling. [inferred]
- **GNO CLI as the backend boundary**: the plugin invokes `gno … --json` via
  Quickshell `Process` and parses stdout. No custom helper daemon in v1; if
  profiling later shows subprocess latency hurts, a persistent helper is a
  future optimization, not part of this spec. [inferred]

Data flow and caching model: [inferred]

- **Snapshot poll**: the bar widget refreshes a compact status snapshot
  (`gno peek --json`, from the sibling spec) on a coarse timer and on panel
  open. Last successful snapshot is retained as **last-good cache**; failures
  mark the display stale rather than blanking it.
- **Recall overlay**: on summon, shows recent documents from the cached
  snapshot immediately. Keystrokes filter the cached title list locally with
  zero subprocess spawns per keystroke. Committed search is **Enter-only**
  (review consensus: debounce-while-typing contradicts the
  zero-subprocess-per-keystroke promise) — one `gno search … --json` (BM25)
  per commit; any in-flight search is cancelled and its late result
  suppressed before a new one starts.
- **Cache lifecycle**: last-good cache is **memory-only** — dropped on
  Quickshell restart, never persisted to disk (titles/paths/snippets are
  private data with invalidation problems on disk). The service records
  `lastSuccessfulRefreshAt` for cache-age display and tags refreshes with a
  generation ID so a late-finishing process can never overwrite newer state.
- **State model**: every async surface has explicit states — loading, ready,
  stale (last-good shown, refresh failing), error — mapped to distinct
  visuals. Error splits into plugin-local causes (gno binary not found /
  not executable, version skew, spawn failure, timeout, malformed output)
  and gno-reported causes (`initialized:false` → init guidance; `RUNTIME`
  envelope → degraded).

Plugin components: `manifest.json` (kinds: **service + bar-widget +
overlay**, `keepLoaded: true` — plan-time correction: a manifest `panel`
kind is a standalone summonable surface on Omarchy and would steal the
plugin id's shell-toggle target from the overlay, so the anchored panel is
an internal `Panel.qml` loaded by the bar widget, per the first-party
clock/weather pattern), `BarWidget.qml`, `Panel.qml`, `RecallOverlay.qml`,
a shared `Service.qml` singleton owning all `Process` invocations, caching,
and state. [paraphrase]

## API Contracts
<!-- API Contracts: 30% [paraphrase], 70% [inferred] -->

Consumed contracts (delivered by the sibling gno-side spec; duplicated here
because they constrain this plugin): [paraphrase]

**`gno peek --json`** success shape (fields shown are the contract; exit 0
even when uninitialized — uninitialized is a state, not an error):

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

`initialized:false` → nulls/`[]` per the sibling contract and drives the
init-guidance state. Real failures arrive as the existing gno error envelope
(`RUNTIME`, exit 2) and drive the degraded state. `gnoVersion` is what the
plugin checks its version floor against. [paraphrase]

Additionally consumed: `gno search --json --no-project-affinity -n <limit>`
for committed queries (Quickshell's CWD is meaningless, so project affinity
must be disabled; the documented source-path field on results feeds the
open-file action), `absPath` from peek recents, and the frozen web-UI
deep-link template `{serveUrl}/doc?uri=<encodeURIComponent(uri)>`. The
plugin consumes only documented JSON contracts — no scraping of
human-readable output, and no full-content `gno get` just to resolve a
path. [paraphrase]

Provided contract: an IPC summon entry point with **toggle** semantics
(summon when hidden, dismiss when shown; repeated invocations toggle) so any
keybinding or script can drive the overlay; the overlay opens on the focused
monitor, grabs keyboard focus, and Esc always dismisses. [paraphrase]

## Edge Cases & Constraints
<!-- Edge Cases & Constraints: 90% [inferred], 10% [user] -->

- **Keybinding**: SUPER+G is taken (Omarchy window grouping), so the default
  is **SUPER+R** ("Recall") — verified free against Omarchy Quattro defaults
  (plain-SUPER letters in use: C F G J K L O P S T V W X). The default is
  applied only through a conflict-checked install step: if SUPER+R (or any
  chosen key) is already bound, the plugin never silently overrides it —
  it surfaces the conflict and falls back to unbound + guidance. Summon stays
  exposed via IPC so the keybind remains fully configurable ("it should have
  a configurable keybind probably"; "maybe we can find a free one and use
  that by default, helpful for users"). README documents the default, the
  conflict check, and alternatives (e.g. SUPER+N, noting it collided with the
  editor bind in pre-Quattro Omarchy). [user]
- **Executable discovery**: Quickshell does not inherit an interactive-shell
  `PATH`, so the plugin supports a configurable absolute `gno` path with a
  PATH-lookup fallback, invokes commands as argument arrays (never shell
  strings), captures stdout/stderr/exit status independently, and bounds
  output size as well as runtime. Binary-not-found, not-executable, and
  version-skew (peek `gnoVersion` below the floor, or unknown `peek`
  subcommand on an old gno) are plugin-local states — they cannot come from
  peek because a missing binary produces no JSON at all. [paraphrase]
- **gno absent vs index uninitialized**: distinct guidance states — install
  hint (plugin-local spawn failure) vs `gno init` hint (peek
  `initialized:false`). Never a crash, never a blank widget. [inferred]
- **Empty-but-initialized** (`counts.documents == 0`): an explicit "index
  something" empty state, distinct from uninitialized. [paraphrase]
- **`gno serve` not running**: "open in web UI" actions surface a clear
  affordance instead of failing silently; the plugin never auto-starts the
  server implicitly. [inferred]
- **Subprocess hygiene**: every invocation has a timeout; malformed or partial
  JSON is treated as a failed refresh (last-good cache retained, stale marker
  shown); overlapping refreshes are coalesced. [inferred]
- **Performance**: overlay summon-to-interactive target < 150 ms (cached
  recents render immediately); zero subprocess spawns per keystroke; bar
  refresh on a coarse timer (minutes, not seconds). [inferred]
- **Theming**: Omarchy theme tokens only — no custom palette — so the plugin
  follows every theme switch. Signals never rely on color alone (glyph/badge
  shape changes accompany color). [inferred]
- **Privilege boundary**: plugin runs unsandboxed inside the Quickshell
  process (Omarchy's model); it only ever executes `gno` and open/URL
  handlers, documented in the README. [inferred]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** A new public repository contains the plugin with a `manifest.json`
  that passes `omarchy plugin validate` and QML that passes `qmllint`; README
  documents install (`omarchy plugin add <url>`), update, removal,
  dependencies (gno version floor), and the privilege boundary. Errors: no
  error surface beyond validation tooling exit codes. [user]
- **R2:** The bar widget is quiet by default (glyph only when healthy) and
  changes state only when actionable: backlog/stale badge, and a distinct
  error/degraded state; states are distinguishable without color alone.
  Errors: gno missing/not-executable/version-skew → setup-guidance state
  (plugin-local detection); `initialized:false` → init-guidance state;
  `RUNTIME` envelope → degraded state. [inferred]
- **R3:** Clicking the bar widget opens an anchored panel showing index
  health, document/collection counts, backlog, and recent documents, with
  actions to open the web UI and summon the recall overlay. Errors: stale
  cache shown with staleness marker when refresh fails. [inferred]
- **R4:** The recall overlay shows recent documents on empty query; typing
  filters cached titles instantly (zero subprocess per keystroke); committed
  search is **Enter-only** (no debounce-triggered searches), running one
  `gno search --json --no-project-affinity -n <limit>` with in-flight
  cancellation and late-result suppression; results show title (falling back
  to the URI tail when null), collection, snippet, and modified time; full
  keyboard flow (summon → type → arrows → Enter → Esc) works without mouse.
  Errors: search failure/timeout → inline error state, overlay stays
  interactive; empty results → explicit empty state; empty-but-initialized
  index → explicit "index something" state. [paraphrase]
- **R5:** From panel and overlay, a result can be opened as source file
  (default handler) and in the GNO web UI (deep-link contract). The plugin
  never auto-starts `gno serve`; when it is not running the UI offers explicit
  guidance instead. Errors: open-action failure → non-blocking notice.
  [inferred]
- **R6:** Summon is exposed via IPC so users can bind any key; the plugin
  ships **SUPER+R** as the default binding, applied via a conflict-checked
  install step (verified free against Omarchy Quattro defaults at spec time);
  when the key is already bound, the plugin never overrides it — it reports
  the conflict and leaves summon unbound with guidance; README documents the
  default, the check, and alternatives (SUPER+G is taken by Omarchy's window
  grouping; SUPER+N collided with pre-Quattro editor binds). Errors: existing
  bind detected → conflict notice + unbound fallback; IPC unavailability →
  logged, bar/panel remain functional. [user]
- **R7:** Resilience and theming: memory-only last-good cache (dropped on
  Quickshell restart, never written to disk) with visible staleness and
  cache age from `lastSuccessfulRefreshAt`, generation-ID-tagged refreshes
  so late results never overwrite newer state, timeouts on every subprocess
  call, malformed/truncated/oversized output never crashes the shell, and
  all colors/spacing come from Omarchy theme tokens. Errors: this R is the
  error surface for refresh paths. [paraphrase]
- **R8:** QA is heavy and continuous during development, then gates
  publishing. During dev: every surface milestone (bar widget, panel,
  overlay, open actions, keybind install step) is installed from the local
  checkout onto a live Omarchy session and driven with captured evidence
  (screenshots, real JSON, observed states) before the next milestone
  starts — never verified by reading QML. Before publish: marketplace
  submission runs against a **released** gno version containing the
  sibling-spec contracts (that version recorded as the floor in
  README/manifest — never published against an unreleased local build),
  and the full evidence matrix is driven one final time —
  healthy glyph, backlog badge, stale cache, gno-missing, uninitialized,
  empty-but-initialized, serve-down open-in-UI, search empty, search
  timeout, open-file failure, keybind conflict, theme switch, shell
  restart, keyboard-only flow — with captured evidence per state, before
  the manual marketplace-submission task runs; publishing is never
  automated in CI. Errors: unresolved P0/P1 QA findings block submission;
  any waiver is an explicit recorded user decision naming the finding.
  [user]
- **R9:** Executable discovery and compatibility: configurable absolute
  `gno` path with PATH fallback, argv-array invocation only (no shell
  string interpolation of queries), a gno version floor checked via peek
  `gnoVersion`, and distinct surfaced states for binary-not-found,
  not-executable, version-skew/unknown-command, spawn failure, timeout, and
  malformed output. Errors: this R is the error surface for the subprocess
  boundary; none of these states may crash or blank the shell. [paraphrase]
- **R10:** Collection browsing: from the overlay (and an entry point in the
  panel), the user can list all collections (name + document count, from
  `gno status --json` collections[]) and drill into one to page through its
  documents (`gno ls <collection> --json -n <limit> --offset <n>`), fully
  keyboard-driven (Enter drills in / opens, Esc or Backspace navigates back
  before dismissing). Browsed rows derive `absPath` by joining the
  collection's absolute `path` with the URI-decoded `source.relPath`; both
  subprocesses follow the R7/R9 rules (argv arrays, generation IDs,
  timeouts, stdout bounds, memory-only caching). Errors: status/ls failure
  → inline error, browse stays interactive; empty collection → explicit
  copy. "recall and quick browse of our notes" is the founding intent.
  [user]
- **R11:** Enter always opens: pressing Enter on any document row — recents,
  search hits, or browsed collection docs — actually opens the document:
  primary action opens the source file via a visible opener chain (text docs:
  `$VISUAL` — TUI editors wrapped in `omarchy-launch-tui` — then `omawrite`,
  then `omarchy-launch-editor`; otherwise `gio open`/`xdg-open`; the
  `fileOpener` override always wins; raw `xdg-open` alone mis-sniffs markdown
  to a headless nvim and is insufficient) when an
  absPath is available/derivable, and falls back to the web UI deep link
  when serve is running; when neither path is available the row shows
  explicit guidance instead of silently doing nothing. An explicit web-open
  key remains available on every row. Verified live per row type (a real
  window/tab must appear). Errors: opener failure → non-blocking notice.
  [user]

## Boundaries
<!-- Boundaries: 40% [user], 60% [inferred] -->

- The plugin lives in a **new repository** — no plugin code in `gno` or
  `gno.sh`. [user]
- Publishing to the Omarchy plugin catalog happens only **after** full local
  testing, as a **manual task** — never automated. [user]
- No `gno ask` / AI answers in v1 — recall and browse only. [inferred]
- No custom helper daemon/binary in v1 — CLI JSON is the boundary; a
  persistent helper is a future optimization if profiling demands it.
  [inferred]
- No semantic/vector search in the overlay's v1 commit path — BM25 keyword
  search only (fast, no model warmup). [inferred]
- No note editing/creation from the plugin — read/recall only. [inferred]
- No silent keybind override — the SUPER+R default lands only through the
  conflict-checked install step; an existing bind always wins. [user]
- Gno-side contract work (`gno peek`, deep links, MCP/skill sync) belongs to
  the sibling spec "GNO peek command + desktop integration surface", which
  this spec depends on. [paraphrase]

## Decision Context

### Motivation
<!-- scope: business -->

- Publishing order is deliberate: local install + full manual QA first,
  marketplace submission strictly after — the user set this sequencing
  explicitly. [user]
- QA weight is a stated priority, not ceremony: "we want heavy QAing of all
  of this while devving before releasing" — evidence-driven passes recur
  throughout development (per milestone), and the release gate is the last
  of many, not the first. [user]
- Direction was validated by synthesizing three independent model proposals;
  their common ground (quiet bar + recall overlay + CLI JSON boundary) is what
  this spec encodes. [paraphrase]

### Implementation Tradeoffs
<!-- scope: technical -->

- CLI-as-boundary over helper daemon: all three proposals agreed a thin QML
  layer must not embed logic; two of three favored direct CLI JSON for v1
  simplicity — the helper adds a deploy artifact and only pays off if
  subprocess latency is measurable in practice. [inferred]
- Keybinding: a conflict-checked SUPER+R default replaced the earlier
  docs-only stance — the user judged a working out-of-the-box bind more
  helpful; the conflict check at install time is what makes shipping a
  default safe (SUPER+G is taken by Omarchy core; an existing user bind is
  never overridden). Summon stays IPC-based so rebinding is trivial. [user]
- Split origin: this spec and "GNO peek command + desktop integration
  surface" were captured from one conversation; the gno-side surface ships
  independently in a gno release, and this plugin builds on it (dependency
  edge recorded in flow-next). [paraphrase]
- Review amendments (Grok 4.6 + GPT-5.6 Sol, both HAPPY-WITH-CHANGES,
  folded in at the user's direction): committed search is Enter-only
  (debounce cut — it contradicted zero-subprocess-per-keystroke);
  executable discovery/PATH/version-skew became first-class states (R9) —
  Quickshell's PATH is not the login shell's; searches disable project
  affinity (Quickshell CWD is meaningless); cache pinned to memory-only
  with generation IDs; IPC pinned to toggle semantics; the publish gate
  gained a named evidence matrix and a released-gno coupling. [paraphrase]

## Strategy Alignment

- Coherent agent and application surfaces: the plugin is a new consumer of the
  same documented JSON/CLI contracts used by MCP and the web UI.
  [strategy:coherent-surfaces]

## Requirement coverage

| R-ID | Task |
|------|------|
| R1 | fn-120-gno-recall-omarchy-shell-plugin.1 |
| R2 | fn-120-gno-recall-omarchy-shell-plugin.2 |
| R3 | fn-120-gno-recall-omarchy-shell-plugin.3 |
| R4 | fn-120-gno-recall-omarchy-shell-plugin.4 |
| R5 | fn-120-gno-recall-omarchy-shell-plugin.5 |
| R6 | fn-120-gno-recall-omarchy-shell-plugin.5 |
| R7 | fn-120-gno-recall-omarchy-shell-plugin.6 |
| R8 | fn-120-gno-recall-omarchy-shell-plugin.7 |
| R9 | fn-120-gno-recall-omarchy-shell-plugin.1 |
| R10 | fn-120-gno-recall-omarchy-shell-plugin.8 |
| R11 | fn-120-gno-recall-omarchy-shell-plugin.9 |

## Parked unknowns

- Repository name for the new plugin repo (e.g. `omarchy-gno-recall` vs
  `gno-omarchy`) — resolved by the user at repo-creation time.
- Final user-facing plugin display name ("GNO Recall" is the working name) —
  resolved by the user before marketplace submission.
