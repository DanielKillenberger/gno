# Reliable watcher reconciliation for atomic writes and deletions

## Overview

Continuous indexing in `gno serve` / `gno daemon` silently misses documents written by
atomic savers. `src/serve/watch-service.ts:203-212` treats the filename reported by
recursive `node:fs.watch` as authoritative: if the reported relative path fails
`matchesWalkPath` (`src/ingestion/walker.ts:187`), the event is dropped and
`syncPaths` never sees the directory. An atomic writer creates `.hermes-tmp.<id>`
and renames it to `final.md`; on Linux, Bun forwards only the source (temp) name
(oven-sh/bun#36328), so the final `*.md` is never presented for ingestion and stays
invisible until a manual `gno update`.

The fix reclassifies filesystem events as **hints about a changed area**. Exact
eligible paths keep the existing per-path incremental flow untouched. Ambiguous
paths mark their **parent directory** dirty; at flush time the watcher reconciles the
union of (a) eligible direct children on disk and (b) active indexed documents that
are direct children of the same directory, then hands the deduplicated relative
paths to the existing `defaultSyncService.syncPaths`, which already stats each path,
ingests material changes, and marks missing paths inactive
(`src/ingestion/sync.ts:1218-1267`).

This is a watcher-correctness bug fix. It is not a second indexing daemon, a timer
fallback, or an ingestion rewrite.

## Verified production evidence

Environment: GNO 1.30.1, Bun on Linux, `gno serve` running continuously.

1. The status endpoint reported the configured collections as actively watched.
2. The process had active inotify descriptors and recursive watches.
3. A normal `cp` of an eligible Markdown file into a watched collection became
   retrievable without `gno update` in approximately 2.5 seconds.
4. An atomic writer created `.hermes-tmp.<id>` in the destination directory and
   renamed it to `final.md`.
5. A standalone recursive Bun `fs.watch` observed only the temporary path for that
   write sequence; it did not report the final Markdown path.
6. GNO did not index the resulting eligible Markdown file within repeated 45-second
   probes, including after restarting `gno serve`.
7. Deleting an indexed eligible probe advanced watcher sync state, but the document
   remained retrievable until a full `gno update` marked it inactive.
8. `gno update` successfully reconciled both missed additions and stale deletions,
   proving that full collection ingestion is correct enough to repair the index.

The hidden-file probe is not evidence of a defect by itself: dotfiles may
intentionally be excluded. The ordinary Markdown and copy probes establish the
relevant contrast.

Upstream corroboration found during planning:

- **oven-sh/bun#36328** — on Linux, `IN_MOVED_FROM`/`IN_MOVED_TO` arrive in one kernel
  batch but Bun forwards only the source name, so atomic saves never report the
  destination filename. This is the proven root cause of evidence item 5/6.
- **oven-sh/bun#33110** — watcher queue overflow now surfaces as `('change', null)`.
- **oven-sh/bun#15939** — recursive watch on Linux can miss files created inside a
  newly created subdirectory.
- **oven-sh/bun#33396** — recursive watch leaked inotify descriptors on directories
  moved out of the tree (fixed upstream; confirm against the pinned Bun in
  `package.json`, `bun >=1.3.0`).

## Measured watcher behavior (task `.1`, Bun 1.3.11)

Captured from a real recursive `fs.watch` on linux 6.10.14 (tmpfs-backed container, genuine
inotify) and cross-checked on darwin 25.5.0. Every `eventType` was `rename` on both
platforms; **no `null` filename was ever observed**.

| scenario | linux reports | darwin reports |
|---|---|---|
| direct create | `direct.md` | `direct.md` |
| atomic save, plain temp (`note.md.tmp` → `note.md`) | `note.md.tmp` only | both |
| atomic save, dot temp (`.gno-tmp.x` → `hidden.md`) | `hidden.md` only | both |
| atomic replace, nested | `nested/note.md.tmp` only | all three |
| single-file delete | `direct.md` | `direct.md` |
| recursive directory delete (`dir1` holding `a.md`, `b.md`) | `dir1` only | children + `dir1` |
| write into a subdirectory created after watch start | **nothing** | `post/d.md` |
| case-only rename | `foo.md` | both |

This measurement corrects three assumptions the plan was originally written on:

1. **bun#36328 is real and unfixed** for plain temp names — the destination is never
   reported. The core premise stands.
2. **Bun's Linux recursive watcher never reports dot-prefixed names at all.** For a
   dot-prefixed temp the source is filtered out and only the destination survives, which
   the existing code already handles. The ambiguity is real only for **non-dot** temp
   names. This directly contradicts production evidence item 5, which observed only the
   `.hermes-tmp.<id>` path — see Open questions.
3. **The deletion defect is not a single-file delete.** A single-file delete names the
   deleted file on both platforms, which is why the pre-existing green deletion test
   passes and why the live failure was never reproducible from it. The real stale-active
   condition is a **recursive directory delete** reporting only the directory.

### Bun 1.3.14 divergence (post-review, reporter's Linux VPS + container)

The shapes above are **not stable across Bun patch releases**. Re-captured on the
the reporter's own Linux VPS running GNO (Bun 1.3.14, kernel 7.0.0-27-generic, ext4, real
inotify, not a container) and reproduced in a `tmpfs` container on the same version:

| scenario | Bun 1.3.11 / linux | Bun 1.3.14 / linux |
|---|---|---|
| recursive directory delete (`dir1` holding `a.md`, `b.md`) | `dir1` only | **one arbitrary child only** — `dir1/b.md` on hardware, `dir1/a.md` in the container |
| atomic save, dot temp (`.gno-tmp.x` → `hidden.md`) | destination only | **the dot temp source** (`.gno-tmp.abc123`) |
| write into a subdirectory created after watch start | nothing | `post/d.md` (bun#15939 appears fixed) |

The recursive-delete change is the defect this corrective commit fixes, and the
important property is that **which child is named is arbitrary** — it is not the
first, not the last, and it differed between hardware and container on the same
Bun version. Because the named child is an ELIGIBLE path, it took the exact-path
fast path, so no reconciliation ran and every unnamed sibling stayed active
indefinitely (confirmed live: `a.md` disappeared from `POST /api/search` while
`b.md` was still retrievable 30s later).

The consequence for the design: "ineligible ⇒ hint / eligible ⇒ authoritative"
is wrong for deletions. A deletion event naming an eligible path is provably not
a complete report. Correctness is therefore conditioned on the DISK — a reported
path that no longer exists is one sample of a larger removal — rather than on
any event shape, which is the only formulation that survives a patch release.

Two further platform defects were measured and are constraints on task `.3`, not
requirements of it:

- **Post-watch subdirectories are invisible on Linux** (confirms bun#15939). Writes into a
  directory created after the watch began produce no events whatsoever, and writes into a
  *renamed* pre-existing directory are reported under the stale pre-rename path. No
  event means no hint, so reconciliation cannot help; this stays a documented limitation.
- **Events collapse per watcher read batch.** A ~5 ms separation is enough to split them;
  300 rapid writes delivered 20 events. Coalescing assertions in `.3` must therefore
  measure reconciliation batches, never delivered event counts.

## Current implementation and root-cause boundary

### Proven atomic-write failure

`src/serve/watch-service.ts` currently:

1. receives `eventType` and `filename` from recursive `node:fs.watch`
   (`:197-220`, one watcher per collection created in `updateCollections` `:127-232`);
2. converts `filename` to a POSIX collection-relative path (`:199`);
3. immediately applies `matchesWalkPath` with `collectionToWalkConfig(currentCollection, 0)`
   (`:203-212`);
4. returns without queueing when the reported path is ineligible;
5. checks `#suppressedPaths` (`:214-217`) and only then calls `#queueChange`
   (`:278-297`, 300 ms debounce), which flushes through `#flushCollection`
   (`:299-435`) into `syncPaths` (`:348-356`).

For an atomic save where Bun reports only `.hermes-tmp.<id>`, step 4 rejects the
path, so the final `*.md` never reaches `syncPaths`.

This is a generic mismatch between event shape and final filesystem state. The fix
must not special-case Hermes or any particular temporary filename.

### Deletion root cause is not yet proven

`syncPaths` already handles a known missing eligible path by marking active
documents inactive (`src/ingestion/sync.ts:1218-1267`), and
`test/serve/watch-service.test.ts:550-595` contains green deletion coverage.
`matchesWalkPath` is deliberately filesystem-free (`walker.ts:182-186`) so a
deleted `deleted.md` still passes eligibility. Therefore the observed live deletion
failure must not be attributed to `markInactive` without a failing reproduction.

Likely causes include Linux event shape (a delete that surfaces only as a rename of
a temp name, or as a directory-level event), path normalization, event coalescing,
directory-level rename semantics, or a difference between the existing fake-watcher
test and real Bun behavior. Task `.1` must capture the real event sequence and
produce a RED regression before product code changes.

## Approach

### Exact-path fast path (unchanged)

When the reported relative path is eligible under the **current** collection
configuration:

- preserve the existing debounce and `syncPaths` path;
- preserve suppression semantics (`#suppressedPaths`, keyed by absolute path);
- do not enumerate the directory;
- emit/schedule only when ingestion reports a material add or update
  (`changedPaths`, `watch-service.ts:72-85`).

### Bounded reconciliation path (new)

When an event cannot safely identify the final eligible path, queue the smallest
trustworthy area as dirty, in a structure parallel to the existing
`#pendingByCollection` relPath set and keyed by collection + directory relPath. The
collection root is a first-class directory key (a reported name with no `/` yields the
root, represented as `""`).

Two directory keys are queued for an ambiguous event, because measurement (task `.1`)
showed the parent alone is insufficient:

- the reported path's **parent** directory — covers an atomic save that reports only a
  temp sibling (`note.md.tmp` → the real `note.md` is a sibling);
- the reported path **itself** — covers a recursive directory deletion, which Linux
  reports as the bare directory name (`dir1`) with no child events at all. Its indexed
  children are direct children of `dir1`, not of `dir1`'s parent, so a parent-only rule
  never deactivates them.

The reported path is not stat-able in the deletion case, so both keys are queued
unconditionally for an ambiguous event and resolved at flush time; a key that turns out
not to be a directory yields `missing` from the enumeration seam and reconciles against
the indexed side only, which is exactly the desired deletion behavior.

At flush time, for each dirty directory:

1. enumerate the **direct** eligible children on disk (new single-level enumeration
   helper; `FileWalker.walk` only walks recursively from the collection root and has
   no depth bound);
2. obtain the **active** indexed documents whose relative paths are direct children
   of the same directory (new narrow store query — see Decision context);
3. union and deduplicate those relative paths with any exact paths already pending
   for the same collection;
4. hand the single deduplicated batch to the existing `syncPaths`.

This provides both sides required for reconciliation: eligible files now present on
disk including an atomic writer's unreported final path, and active indexed files no
longer present, enabling normal missing-path deactivation.

### Noise control

An ineligible event is not permission to index the ineligible file. Directory
reconciliation re-applies the current collection include/exclude/pattern/reserved-path
rules to every candidate, at both the queue-time and the existing flush-time
re-filter (`watch-service.ts:332-334`).

Repeated events coalesce by collection + directory inside the existing 300 ms
debounce window. Unchanged files continue to short-circuit through ingestion, and a
reconciliation batch must not produce duplicate `document-changed` events or
redundant embedding work for unchanged neighbours.

## Quick commands

```bash
# Targeted regression suite for this spec
bun test test/serve/watch-service.test.ts

# Ingestion + store suites touched by the new seams
bun test test/ingestion/ test/store/

# Full gates
bun run lint:check
bun run typecheck
bun test
git diff --check
```

## Boundaries / non-goals

- A cron, systemd timer, polling loop, or second watcher implementation
- A full collection sync for every event
- Special handling for `.hermes-tmp`, Vim, Emacs, Obsidian, or any named editor
- Frontend changes
- Reworking the embedding scheduler
- Config-file hot reload beyond existing `updateCollections` semantics
- Guaranteeing recursive discovery for an entire newly moved directory tree in this
  bug-fix slice (a directory rename reconciles the old parent and the new parent, not
  the whole moved subtree)
- Solving platform/runtime defects that provide neither a filename nor a trustworthy
  affected directory. A `null` filename (Bun queue overflow) stays out of scope for
  recovery; R9 only requires that it cannot crash the callback and that it is visible
  in diagnostics so the follow-up can be specified separately.
- Changing the existing event semantics of a deletion. `syncPaths` reports a
  deactivated file with status `updated`, which today emits one `document-changed`
  event; the Web UI depends on that refresh signal. R5 constrains only *new*
  reconciliation-induced noise (unchanged neighbours), not this pre-existing mapping.

## Decision context

**Why directory-bounded reconciliation rather than trusting the event.** Every mature
watcher converges on the same answer — chokidar's `atomic`/`awaitWriteFinish`,
Watchman's settle window and cookie files, and VS Code's native-backend rescan all
treat an event as "something in this directory may have changed" and re-read the
directory. Bun#36328 makes trusting `filename` provably wrong for the exact case this
spec reproduces.

**Why a new narrow store query rather than reusing `listDocuments`.** The spec permits
a store seam only if no existing bounded query is adequate. `StorePort.listDocuments`
(`src/store/types.ts:1605`, `src/store/sqlite/adapter.ts:1513-1535`) issues
`SELECT * FROM documents WHERE collection = ?` with no `active` filter and no path
bound. Reconciliation runs on every ambiguous event, so a whole-table fetch per flush
is not adequate for large vaults. Add one narrow, indexed query returning active
document relative paths that are direct children of a directory, exposed through the
existing store port.

**Why no public status-schema change.** R7 asks for enough diagnostics to distinguish
event receipt from successful reconciliation. `CollectionWatchState`
(`watch-service.ts:260-276`) is mirrored verbatim by
`spec/output-schemas/status.schema.json:491-536`, `docs/API.md:508-518`, and
`docs/WEB-UI.md:460-475`. The existing `CollectionWatchCallbacks`
(`onSyncStart`/`onSyncComplete`/`onSyncError`/`onSettled`) plus structured logging
carry collection + directory + outcome without widening the public contract. If
implementation proves a state field is unavoidable, the schema, contract tests, and
both docs pages change in the same commit.

**Why the store query resolves record source paths.** Record-container documents
(JSONL/transcript exports) live in the store under virtual paths
(`isRecordVirtualPath`, `src/ingestion/record-path.ts:14`) while their physical input
path is `documents.record_source_path` (`spec/db/schema.sql:115`, indexed on
`(collection, record_source_path)` at `:147-149`). `syncPaths` stats physical paths.
The active-children query must therefore return the *effective source path*
(`COALESCE(record_source_path, rel_path)`, distinct), or deleting an eligible record
container would leave all of its logical records active — a silent R3 failure.

**Why the store seam needs an indexed parent key.** A direct-child predicate over
`COALESCE(record_source_path, rel_path)` is not servable by the existing indexes: the
active-path index covers `collection` only, so SQLite would scan every active document
in the collection and build a temporary B-tree for `DISTINCT` — recreating exactly the
whole-collection work this design rejects. The collection-root case is worse: `""` as a
parent is not expressible as a prefix range at all. The seam therefore needs an indexed
*parent* representation (a generated or maintained `source_parent_path` plus a partial
index on `(collection, source_parent_path)` where the row is active), turning both root
and nested lookups into equality probes. `EXPLAIN QUERY PLAN` evidence showing the
parent bound is used is part of the task's acceptance, not a nice-to-have.

**Why the enumeration result is a three-state outcome.** "Directory is gone" and
"directory is unreadable" demand opposite watcher behavior. A vanished directory must
still reconcile against the indexed side so its children deactivate; an `EACCES`/`EIO`
failure must never be read as an authoritative empty directory, because that would
deactivate live documents. The seam returns a discriminated `present(paths)` /
`missing` / `error(cause)` result rather than an empty array for both.

**Why diagnostics get their own callback events.** The existing
`CollectionWatchCallbacks` (`watch-service.ts:26-40`) are path-sync-shaped:
`onSyncStart`/`onSyncComplete`/`onSyncError` all carry a `relPaths` array and fire
around `syncPaths`. They cannot express "an ambiguous event arrived", cannot name
which directory was reconciled when several coalesce into one batch, and cannot
report a dropped `null` filename. `CollectionWatchService` has no logger dependency;
its consumers do the logging (`src/cli/commands/daemon.ts:150-170`,
`src/serve/resident-runtime.ts:296`). R7 is therefore satisfied by additive optional
callback events wired into those existing consumers — not by "structured logging" in
the abstract, and still not by widening the public status schema.

**Why generation drift keeps two policies.** The post-sync drift loop
(`watch-service.ts:365-413`) already re-runs a FULL `syncCollection` whenever the
collection generation changed during a flush. That behavior is preserved verbatim for
exact-path batches. It also subsumes any dirty-directory work that was in flight, so
reconciliation adds no second bounded pass on the drift path. The "never a full
collection sync" boundary describes steady-state event handling, not this pre-existing
config-change recovery.

**Why the parent directory and not the whole collection.** Full-collection sync on
every ineligible event turns temp-file churn from a build tool into repeated
whole-vault walks. Direct children of one directory keeps the blast radius
proportional to the event.

## Acceptance Criteria

- **R1:** Exact eligible create and update events continue through the existing
  per-path debounce/sync flow without widening to a directory scan: the reported
  file EXISTS, so the event named the whole change. **Amended after the Bun
  1.3.14 measurement below** — a DELETE cannot make that promise. An eligible
  reported path that no longer exists on disk is one sample of a larger removal,
  so it also reconciles its directory, walking up to the shallowest removed
  ancestor. The widening is conditioned on the DISK, not on the event type, and
  costs one `stat` per pending path; the live-edit hot path is unchanged.
  **Bounded after the second review** — because the widening decision is a `stat`
  taken when the flush drains the queue, and Bun coalesces whatever lands in one
  watcher read batch, a path that is deleted and RECREATED before that `stat`
  cannot be distinguished from an edit. Such a path is synced as an edit and
  nothing widens; siblings removed in the same window stay active until another
  event names their area or `gno update` runs. This window is inherent to
  observing removals through a coalescing event stream and is documented rather
  than claimed away. Once a path (or an ancestor) HAS been classified as
  removed, that classification is carried on the queue and survives a later
  recreation: the enumeration that follows may only widen the disk side of the
  union, never narrow a subtree removal back to direct children.
- **R2:** When a filesystem event reports an ineligible or otherwise ambiguous path
  inside a watched collection, GNO discovers an eligible final file created by an
  atomic save in the same directory without a manual `gno update`. Reconciliation is
  bounded to the smallest affected directory and hard-codes no editor, Hermes, or
  temporary-file naming convention.
- **R3:** A watched eligible file deleted after watcher readiness becomes inactive and
  is no longer retrievable without a full collection update. The implementation rests
  on a deterministic failing reproduction of the real event/path condition, not an
  assumed ingestion defect. The measured condition is a recursive directory delete that
  reports only the directory name (see Measured watcher behavior), not a single-file
  delete. This holds up to and including the collection ROOT: a collection
  directory that is genuinely absent from disk deactivates every document
  indexed under it, at any depth. The ancestor walk still refuses to climb past
  the root — that ceiling is what keeps a deletion from escalating above the
  collection — but the ceiling is not a claim that the root exists, and the two
  are now decided separately. Absence (`ENOENT`/`ENOTDIR`) deactivates; a root
  that merely cannot be statted (`EACCES`/`EIO`, a hung mount) fails closed
  under R9 and deactivates nothing.

  The classification never rests on the NAME. A directory may legitimately
  carry a filename-shaped name — `archive.md/` matches a `*.md` collection
  pattern exactly as a document does — so an eligible reported name is not
  evidence that the thing that vanished was a file. A vanished path whose
  parent survived is therefore treated as a POSSIBLE directory and decided on
  the indexed side (R12), never collapsed to its parent because its name looked
  like a document.
- **R4:** Reconciliation consults the current collection configuration and preserves
  `pattern`/`include`/`exclude` behavior, dotfile/temporary/reserved-path exclusions,
  path normalization and collection-root containment, configured limits and
  content-type behavior supplied through existing sync options, and suppression of
  known application-originated writes. Ineligible files remain unindexed even when
  their event causes directory reconciliation.
- **R5:** Repeated or coalesced filesystem events for the same collection and
  directory result in one bounded reconciliation batch per debounce window. Unchanged
  files produce no duplicate document-change notifications and no redundant embedding
  scheduling. Adds and updates retain existing event/scheduler behavior.
- **R6:** Queued work is evaluated against the current collection path, filters, sync
  options, and generation. A collection update, removal, root change, or service
  disposal cannot flush stale reconciliation work into the wrong configuration.
  Drift detected **before** enumeration re-resolves the dirty directory against the
  current configuration, or drops it when the root changed or the collection is gone.
  Drift detected **during** any awaited flush stage - path **classification**
  (`stat`-ing reported exact paths), enumeration, or while `syncPaths` is in flight -
  falls to the existing full-`syncCollection` recovery loop, which is a superset of the
  bounded work; reconciliation adds no second compensating pass. The revalidation is
  **unconditional at every flush resume point**, not attached to whichever branch owns
  the current await: an exact-path batch with no dirty directories never enters the
  enumeration branch, so a branch-local guard leaves that batch syncing against a
  configuration that has already moved. On drift the whole in-hand batch is dropped -
  bounded candidates and exact paths alike - and a removed collection drops the batch
  and its queues with no recovery attempt at all.
- **R7:** Additive optional callback events on `CollectionWatchCallbacks`, wired into
  the existing consumers that already log watcher activity, make it possible to
  determine that an ambiguous event was received (including a dropped `null`
  filename), which collection and normalized directory were reconciled, whether
  reconciliation completed or failed and at which stage, and that the watcher remains
  armed. Filenames are treated as untrusted input when formatted. Existing callbacks
  keep their current shape and remain optional, so present consumers compile
  unchanged. Any public status-schema change ships with matching contract tests and
  documentation in the same commit.
- **R8:** Tests cover exact-path and ambiguous-event paths deterministically without
  fixed sleeps standing in for synchronization. A real temporary-directory smoke test
  captures Bun's event shape and proves the watch-to-index lifecycle where the
  runtime supports it, with deterministic cleanup and a hard timeout.
- **R9:** A reconciliation-path failure degrades safely and visibly. A **vanished**
  dirty directory still reconciles against the indexed side so its children deactivate.
  An **unreadable** directory (`EACCES`/`EIO`) and a store-query failure fail closed —
  no deactivation is inferred from them — and are reported with their cause. A `null`
  filename is dropped without recovery, but is reported. None of these can throw out of
  the watch callback or silently disarm the watcher; all are visible through the R7
  diagnostics.
- **R10:** Reconciliation resolves record-backed documents through their physical
  source path, not their virtual record path. Deleting or atomically replacing an
  eligible record container reconciles every active logical record derived from it.
- **R11:** The active-children lookup is index-served for both the collection root and
  nested directories — no whole-collection scan and no temporary B-tree for `DISTINCT`
  — proven by a query plan captured as evidence. The same holds for the active
  DESCENDANT lookup added for removed subtrees: a bounded range over the parent
  key (`>= 'dir1' AND < 'dir10'`, with an exact containment residual so `dir1`
  can never match `dir10/x.md`), single and batched, index-served at every key
  count.
- **R12:** A recursive directory deletion deactivates **every** indexed document
  beneath the removed directory, at any depth, however the runtime reports it —
  as the bare directory (Bun 1.3.11), as one arbitrary child at any depth (Bun
  1.3.14), or as children plus the directory (macOS). The earlier "direct
  children only" limitation is REMOVED: the watcher resolves the shallowest
  removed ancestor from disk and reconciles its whole subtree against an indexed
  descendant lookup. A directory that still EXISTS stays direct-children-bounded,
  so nothing nested below a surviving directory is pulled in by a temp-file
  event. Deleting the collection ROOT is the same case one level up and is
  covered: the whole collection's active documents deactivate, from the
  whole-collection indexed seam that the bounded descendant lookup cannot
  express for `""`.

  This holds however the removed directory is NAMED, including a name that
  matches the collection pattern. A deleted `archive.md/` holding
  `archive.md/child.md` reports the bare `archive.md`, which is ELIGIBLE and so
  arrives on the exact-path route rather than the ambiguous-event route; its
  documents still deactivate. The directory-vs-file decision is made in the
  watcher's classification step, on the indexed side, using the same batched
  active-descendant lookup the ambiguous route uses: descendants beneath the
  vanished path mean a removed subtree, none means an ordinary vanished file
  that collapses to its surviving parent. The path-resolution module stays
  filesystem-only and holds no store dependency, and the discriminator costs no
  per-path query — a whole debounce window's vanished paths are answered in one
  round trip per seam (R5).

  Two documented limitations remain, neither about depth:

  - Linux subdirectories created after the watcher started emit no event at all
    (bun#15939) and still require `gno update`;
  - a deleted path that is RECREATED before the flush's `stat` reads as an edit
    (R1), so a removal coalesced with a recreation inside one debounce window is
    not observed. An ancestor recreated AFTER classification but before
    enumeration does not narrow the reconciliation — that intent is carried on
    the queue.

## Early proof point

Task `fn-114-reliable-watcher-reconciliation-for.1` validates the core premise: that
the real Bun event stream for an atomic temp-write-plus-rename never names the final
eligible file, and that a deterministic injected replay of that sequence fails today.
If the captured sequence *does* report the final path, the root cause is elsewhere
(normalization, suppression, or ingestion) and the directory-reconciliation design in
`.2`/`.3` must be re-evaluated before implementation.

## Requirement coverage

| Req | Description | Task(s) | Gap justification |
|-----|-------------|---------|-------------------|
| R1  | Exact eligible paths stay on the incremental path; vanished paths widen, and the delete-then-recreate window is documented | fn-114-reliable-watcher-reconciliation-for.1, fn-114-reliable-watcher-reconciliation-for.3, post-review corrective commit | — (guarantee bounded to what a flush-time `stat` can observe) |
| R2  | Ambiguous atomic-write events reconcile the bounded directory | fn-114-reliable-watcher-reconciliation-for.1, fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.3 | — |
| R3  | Deleted eligible documents deactivate live, from a proven repro, up to and including a removed collection root, and never classified by name alone | fn-114-reliable-watcher-reconciliation-for.1, fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.3, post-review corrective commit | — |
| R4  | Eligibility, normalization, containment, suppression preserved | fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.3 | — |
| R5  | Coalescing; no duplicate events or redundant embedding | fn-114-reliable-watcher-reconciliation-for.3 | — |
| R6  | Live collection generations respected at EVERY flush resume point (classification and enumeration windows alike) | fn-114-reliable-watcher-reconciliation-for.3, post-review corrective commits | — |
| R7  | Diagnostics distinguish event receipt from reconciliation outcome | fn-114-reliable-watcher-reconciliation-for.3, fn-114-reliable-watcher-reconciliation-for.4 | — |
| R8  | Deterministic regression coverage + real-FS smoke proof | fn-114-reliable-watcher-reconciliation-for.1, fn-114-reliable-watcher-reconciliation-for.4 | — |
| R9  | Reconciliation failures degrade safely and visibly, including a failed descendant query and an unstattable collection root | fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.3, post-review corrective commit | — |
| R10 | Record-backed documents reconcile via their physical source path | fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.3 | — |
| R11 | Active-children AND active-descendant lookups are index-served for root and nested directories | fn-114-reliable-watcher-reconciliation-for.2, fn-114-reliable-watcher-reconciliation-for.4, post-review corrective commit | — |
| R12 | Recursive directory delete deactivates the whole removed subtree, collection root included, and directories whose names match the collection pattern | fn-114-reliable-watcher-reconciliation-for.1, fn-114-reliable-watcher-reconciliation-for.3, fn-114-reliable-watcher-reconciliation-for.4, post-review corrective commits | — (depth limitation removed; delete-then-recreate window documented under R1) |

## Test strategy

### RED evidence gate (task `.1`, before any product-code change)

1. Record the real Bun event sequence for: direct create/write; atomic temp-write plus
   rename; eligible file deletion; atomic replacement of an existing eligible file.
2. Add a deterministic watcher test that injects the observed ambiguous sequence
   through the existing `watchFactory` harness
   (`test/serve/watch-service.test.ts:11-46`) and fails because the final eligible
   file is never synced.
3. Add or adapt deletion coverage to reproduce the live stale-active condition. If the
   fake-watcher harness cannot reproduce it, document the event-shape gap in the task
   evidence and add the smallest real-filesystem seam that can.
4. Preserve the RED command and output as task evidence. Do not weaken expectations to
   make the baseline pass.

### Required automated cases

- eligible file added after watcher readiness through an exact event;
- eligible file updated through an exact event;
- atomic create where only a temporary/ineligible event path is reported;
- atomic replacement of an existing eligible file;
- deletion of an indexed eligible file;
- ambiguous event for a file directly in the collection root (empty-string parent);
- ambiguous event in a nested subdirectory;
- excluded dotfile/temp/reserved file remains unindexed after reconciling its directory;
- unrelated excluded-path noise does not cause unbounded collection work;
- repeated/coalesced events perform one reconciliation batch per window;
- unchanged eligible neighbours produce no duplicate document events or embedding work;
- collection filters changed before flush are honored;
- collection removal / root change / disposal drops stale queued reconciliation safely;
- reconciliation errors (unreadable directory, vanished directory, store failure)
  reach existing error/health diagnostics without disarming the watcher;
- a `null` filename does not throw and is reported as an ambiguous-event diagnostic;
- a vanished dirty directory deactivates its indexed children;
- an unreadable dirty directory deactivates nothing and reports its cause;
- deletion and atomic replacement of an eligible record container reconciles every
  active logical record derived from it.

Use explicit watcher-readiness and `onSettled`/callback synchronization rather than
arbitrary sleeps standing in for a settle signal.

### Real-filesystem smoke

One temp-directory smoke test drives a real recursive `fs.watch` through the atomic
temp-write-plus-rename sequence, with `mkdtemp` setup, deterministic cleanup, and a
hard timeout. It runs where the runtime supports it and skips cleanly otherwise; the
Linux proof is the one that closes the reported defect.

## Risks and mitigations

**Reconciliation amplification.** Noisy temporary-file activity repeatedly scans
directories. Mitigation: coalesce by collection + directory, enumerate only direct
children, preserve the existing debounce, and assert batch counts in tests.

**Large directories.** One directory may contain many documents, and `syncPaths` stats
each path sequentially. Mitigation: stay directory-bounded, reuse eligibility filters,
and avoid content reads before `syncPaths`. The measurement is pinned so it can pass or
fail rather than being declared acceptable after the fact — fixture: one directory with
5,000 eligible files, 500 excluded files, and 200 active-indexed-but-missing paths;
method: five warm runs of one ambiguous event, reporting the median and timing
enumeration, the store query, and the unchanged-`syncPaths` pass **separately** so the
limiting stage is identifiable; criterion: enumeration + store query together at or
under 250 ms median. Exceeding it is not a scope expansion trigger — record the number
and document the ceiling as a known limitation.

**Path escape or stale config.** Malformed relative paths or config mutation could
reconcile outside the intended root. Mitigation: normalize and prove root containment
with the existing helpers, resolve work against the current collection generation, and
discard stale queued work.

**Duplicate events and embedding.** The exact path and the ambiguous parent event can
both arrive for one save. Mitigation: deduplicate exact paths against reconciliation
candidates in a single batch and rely on material sync results for notifications and
scheduling.

**Cross-platform differences.** macOS collapses create/rename/delete into `rename`;
Linux splits them; Windows differs again. Mitigation: keep correctness independent of
event type and name conventions, inject event sequences in deterministic tests, and
keep one real Bun smoke proof.

**Overlap with fn-83.** `fn-83-second-brain-page-types-and-synthesis` task `.3` threads
`contentTypes` rules through `SyncOptions` into every sync entrypoint including
`src/serve/watch-service.ts`. Mitigation: this spec passes sync options through
unchanged and does not alter the `syncPaths` call signature; whichever lands second
rebases on the other.

## Implementation boundaries

Primary files to inspect and likely modify:

- `src/serve/watch-service.ts`
- `test/serve/watch-service.test.ts`
- a single-level eligible-children enumeration helper alongside `src/ingestion/walker.ts`

Store seam (justified in Decision context):

- the store port interface exposing active document paths (`src/store/types.ts`)
- `src/store/sqlite/adapter.ts` and its focused tests

Status/diagnostic contract files (`spec/output-schemas/status.schema.json`,
`docs/API.md`, `docs/WEB-UI.md`) are in scope only if R7 forces a public field.

Do not modify web UI code, unrelated ingestion pipelines, model code, or packaging.

## Data and control flow

```text
fs.watch event
  |
  +-- exact eligible path --------------------+
  |                                           |
  +-- ambiguous/ineligible reported path      |
        -> mark parent dir AND reported path dirty |
        -> coalesce by collection+directory   |
        -> enumerate direct eligible disk children
        -> query active indexed direct children
        -> union + dedupe --------------------+
                                              |
                                              v
                                    existing syncPaths behavior
                                              |
                           +------------------+------------------+
                           |                                     |
                    add/update material                     missing path
                           |                                     |
                 event + embed scheduling                 mark inactive
```

## Open questions

- **ANSWERED by task `.1`:** a single-file delete reports the eligible name on both
  platforms; the ambiguous case is a recursive directory delete reporting only the
  directory. R3/R12 are written against the measured behavior.
- **OPEN, needs the production Bun version.** Production evidence item 5 observed only
  the `.hermes-tmp.<id>` path and never `final.md`. The Bun 1.3.11 Linux capture shows the
  opposite for dot-prefixed temps: the dot name is filtered and only the destination is
  reported. Both cannot be true of the same runtime, so the production host is most
  likely on a different Bun. This does not change the fix — reconciliation covers the
  ambiguous case either way — but it does mean we cannot yet claim the exact reported
  Hermes scenario is reproduced. Confirm the production Bun version before asserting
  that in the PR or changelog.
- Symlink handling: the new direct-children enumeration must match whatever
  `FileWalker.walk` does today (`walker.ts:227-318`). Confirm parity during `.2`
  rather than inventing new behavior.
- macOS case-only renames (`Foo.md` → `foo.md`) on a case-insensitive filesystem —
  document the observed behavior in `.1`; do not add case-folding logic in this slice.

## References

- `src/serve/watch-service.ts:72-85` (`changedPaths`), `:127-232` (`updateCollections`),
  `:197-220` (event callback), `:238-258` (`dispose`), `:260-276` (`getState`),
  `:278-297` (`#queueChange`), `:299-435` (`#flushCollection`), `:448-471` (`#afterSync`)
- `src/ingestion/sync.ts:1164-1382` (`syncPaths`), `:1218-1267` (ENOENT → `markInactive`)
- `src/ingestion/walker.ts:152-175` (`matchesInclude`), `:182-219` (`matchesWalkPath`),
  `:125-144` (`safeRelPath`), `:227-318` (`FileWalker.walk`)
- `src/ingestion/types.ts:293+` (`collectionToWalkConfig`), `src/core/path-rules.ts:31-53`
- `src/ingestion/record-path.ts:14` (`isRecordVirtualPath`); `spec/db/schema.sql:115,145-149`
  (`record_source_path` column and its indexes)
- `src/cli/commands/daemon.ts:150-170`, `src/serve/resident-runtime.ts:296` (watcher
  callback consumers that log)
- `src/store/migrations` (migration framework; `runMigrations` used at
  `src/store/sqlite/adapter.ts:476-477`). SQLite 3.51 via `bun:sqlite` — generated
  columns, expression indexes, and partial indexes are all available
- `src/store/types.ts:1346+` (`StorePort`), `:1605` (`listDocuments`);
  `src/store/sqlite/adapter.ts:1513-1535`, `:1670-1673` (`markInactive`)
- `test/serve/watch-service.test.ts:11-46` (harness), `:550-595` (existing deletion case)
- `spec/output-schemas/status.schema.json:491-536`; `docs/API.md:508-518,614-618`;
  `docs/WEB-UI.md:460-475`; `docs/ARCHITECTURE.md:178`; `docs/DAEMON.md`;
  `docs/TROUBLESHOOTING.md:380-394`
- oven-sh/bun#36328 (atomic rename drops destination filename, Linux),
  #33110 (`('change', null)` on queue overflow), #15939 (new subdirectory children
  missed), #33396 (inotify descriptor leak on moved-out directories)
- Node `fs.watch` caveats: https://nodejs.org/api/fs.html#fswatchfilename-options-listener
- inotify(7): https://man7.org/linux/man-pages/man7/inotify.7.html
- Watchman settle/cookies: https://facebook.github.io/watchman/docs/cookies.html
