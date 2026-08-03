# Reliable watcher reconciliation for atomic writes and deletions

## Goal

Make continuous indexing reliable when the filesystem watcher reports an ambiguous or temporary path rather than the final eligible document path, while preserving GNO's incremental sync, collection filters, debounce behavior, and embedding/event semantics.

## Scope decision

This is a watcher-correctness bug fix. It is not a second indexing daemon, timer fallback, or broad ingestion rewrite.

The implementation should treat filesystem events as **hints about a changed area**, not authoritative proof that the reported path is the final document path. Exact eligible-path events remain incremental. Ambiguous events may trigger a bounded reconciliation of the smallest affected directory.

## Verified production evidence

Environment: GNO 1.30.1, Bun on Linux, `gno serve` running continuously.

1. The status endpoint reported the configured collections as actively watched.
2. The process had active inotify descriptors and recursive watches.
3. A normal `cp` of an eligible Markdown file into a watched collection became retrievable without `gno update` in approximately 2.5 seconds.
4. An atomic writer created `.hermes-tmp.<id>` in the destination directory and renamed it to `final.md`.
5. A standalone recursive Bun `fs.watch` observed only the temporary path for that write sequence; it did not report the final Markdown path.
6. GNO did not index the resulting eligible Markdown file within repeated 45-second probes, including after restarting `gno serve`.
7. Deleting an indexed eligible probe advanced watcher sync state, but the document remained retrievable until a full `gno update` marked it inactive.
8. `gno update` successfully reconciled both missed additions and stale deletions, proving that full collection ingestion is correct enough to repair the index.

The hidden-file probe is not evidence of a defect by itself: dotfiles may intentionally be excluded. The ordinary Markdown and copy probes establish the relevant contrast.

## Current implementation and root-cause boundary

### Proven atomic-write failure

`src/serve/watch-service.ts` currently:

1. receives `eventType` and `filename` from recursive `node:fs.watch`;
2. converts `filename` to a collection-relative path;
3. immediately applies `matchesWalkPath` using the current collection configuration;
4. returns without queueing when the reported path is ineligible;
5. calls `syncPaths` only for queued eligible paths.

For an atomic save where Bun reports only `.hermes-tmp.<id>`, the callback rejects that path because it does not match the collection's eligible document rules. The final `*.md` path is never presented to `syncPaths`, so the document cannot be discovered.

This is a generic mismatch between event shape and final filesystem state. The fix must not special-case Hermes or a particular temporary filename.

### Deletion root cause is not yet proven

`src/ingestion/sync.ts::syncPaths` already handles a known missing eligible path by marking active documents inactive, and `test/serve/watch-service.test.ts` contains green deletion coverage. Therefore the observed live deletion failure must not be attributed to `markInactive` without a failing reproduction.

Likely causes include Linux event shape, path normalization, event coalescing, directory-level rename semantics, or a difference between the existing fake-watcher test and real Bun behavior. Task 1 must capture the real event sequence and produce a RED regression before product code changes.

## Design decision

### Exact-path fast path

When the reported relative path is eligible under the **current** collection configuration:

- preserve the existing debounce and `syncPaths` path;
- preserve suppression semantics;
- do not scan the directory;
- emit/schedule only when ingestion reports a material add or update.

### Bounded reconciliation path

When an event cannot safely identify the final eligible path, queue the smallest trustworthy area—normally the reported path's parent directory—as dirty.

At flush time, reconcile the direct eligible children of that directory against the active indexed documents whose relative paths are direct children of the same directory. Feed the deduplicated union of those relative paths through existing ingestion behavior.

This provides both sides required for reconciliation:

- eligible files now present on disk, including an atomic writer's unreported final path;
- active indexed files no longer present, enabling normal missing-path deactivation.

The implementation may choose an equivalent existing seam if inspection proves it smaller or safer. It must not perform an unbounded full-collection sync for every irrelevant event.

### Noise control

An ineligible event is not permission to index the ineligible file. Directory reconciliation must continue to use current collection include/exclude/pattern/reserved-path rules.

The implementation must coalesce repeated events by collection and directory. Unchanged files must continue to short-circuit through ingestion, and a reconciliation batch must not cause duplicate `document-changed` events or redundant embedding work.

## Requirements

### R1 — Preserve incremental eligible-path sync

Exact eligible create, update, and delete events continue through the existing per-path debounce/sync flow without widening to a directory scan.

### R2 — Reconcile ambiguous atomic-write events

When a filesystem event reports an ineligible or otherwise ambiguous path inside a watched collection, GNO can discover an eligible final file created by an atomic save in the same directory without manual `gno update`.

Reconciliation is bounded to the smallest affected directory and does not hard-code Hermes, editor, or temporary-file naming conventions.

### R3 — Deactivate deleted eligible documents

A watched eligible file deleted after watcher readiness becomes inactive and is no longer retrievable without a full collection update.

The implementation is based on a deterministic failing reproduction of the real event/path condition, not an assumed ingestion defect.

### R4 — Preserve collection eligibility and safety rules

Reconciliation consults the current collection configuration and preserves:

- `pattern`, `include`, and `exclude` behavior;
- dotfile, temporary, and reserved-path exclusions;
- path normalization and collection-root containment;
- configured limits and content-type behavior supplied through existing sync options;
- suppression of known application-originated writes.

Ineligible files remain unindexed even when their event causes directory reconciliation.

### R5 — Coalesce work and emit only material changes

Repeated or coalesced filesystem events for the same collection/directory result in one bounded reconciliation batch per debounce window.

Unchanged files do not produce duplicate document-change notifications or redundant embedding scheduling. Adds and updates retain existing event/scheduler behavior. Deletions do not falsely announce content updates.

### R6 — Respect live collection generations

Queued work is evaluated against the current collection path, filters, sync options, and generation. A collection update, removal, root change, or service disposal cannot flush stale reconciliation work into the wrong configuration.

### R7 — Expose enough diagnostics to distinguish event receipt from successful reconciliation

Existing callbacks/state/logging, or a minimal compatible extension, must make it possible to determine:

- that an ambiguous event was received;
- which collection and bounded directory were reconciled;
- whether reconciliation completed or failed;
- that the watcher remains armed.

Do not expand the public status schema unless necessary. Any schema change requires matching contract tests and documentation.

### R8 — Deterministic regression coverage and Linux smoke proof

Tests cover exact-path and ambiguous-event paths deterministically without fixed sleeps. A real temporary-directory smoke test on Linux captures Bun's event shape and proves the completed watch-to-index lifecycle where CI/runtime support allows it.

## Non-goals

- A cron, systemd timer, polling loop, or second watcher implementation
- A full collection sync for every event
- Special handling for `.hermes-tmp`, Vim, Emacs, Obsidian, or any named editor
- Frontend changes
- Reworking the embedding scheduler
- Config-file hot reload beyond existing `updateCollections` semantics
- Guaranteeing recursive discovery for an entire newly moved directory tree in this bug-fix slice
- Solving platform/runtime defects that provide neither a filename nor a trustworthy affected directory; such cases must be diagnosed and specified separately

## Implementation boundaries

Primary files to inspect and likely modify:

- `src/serve/watch-service.ts`
- `test/serve/watch-service.test.ts`

Only if no existing bounded query is adequate:

- the store port/interface that exposes active document paths;
- `src/store/sqlite/adapter.ts` or the narrow backing query;
- focused store tests.

Potential status/diagnostic contract files are in scope only when required by R7.

Do not modify web UI code, unrelated ingestion pipelines, model code, or packaging.

## Data and control flow

```text
fs.watch event
  |
  +-- exact eligible path --------------------+
  |                                           |
  +-- ambiguous/ineligible reported path      |
        -> mark parent directory dirty        |
        -> coalesce by collection+directory   |
        -> enumerate direct eligible disk children
        -> obtain active indexed direct children
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

## Test strategy

### RED evidence gate

Before product code changes:

1. Record the exact Bun/Linux event sequence for:
   - direct create/write;
   - atomic temp-write plus rename;
   - eligible file deletion;
   - atomic replacement of an existing eligible file.
2. Add a deterministic watcher test that injects the observed ambiguous event sequence and fails because the final eligible file is not synced.
3. Add or adapt deletion coverage to reproduce the live stale-active condition; if the existing fake-watcher test cannot reproduce it, document the event-shape gap and add the smallest integration seam needed.
4. Preserve the RED command/output as task evidence; do not weaken expectations to make the baseline pass.

### Required automated cases

- eligible file added after watcher readiness through an exact event;
- eligible file updated through an exact event;
- atomic create where only a temporary/ineligible event path is reported;
- atomic replacement of an existing eligible file;
- deletion of an indexed eligible file;
- excluded dotfile/temp/reserved file remains unindexed;
- unrelated excluded-path noise does not cause unbounded collection work;
- repeated/coalesced events perform one reconciliation batch;
- unchanged eligible neighbors produce no duplicate document events or embedding work;
- collection filters changed before flush are honored;
- collection removal/root change/disposal drops stale queued reconciliation safely;
- reconciliation errors reach existing error/health diagnostics.

Use explicit watcher-readiness and `onSettled`/callback synchronization rather than arbitrary sleeps.

### Verification commands

The implementation task must determine canonical package scripts from `package.json`, then run at minimum:

```bash
bun test test/serve/watch-service.test.ts
bun test test/ingestion/ test/store/
bunx tsc --noEmit
git diff --check
```

Also run the repository's canonical lint/check command and the full relevant suite. Run a real Linux temporary-directory smoke test when supported, with deterministic cleanup and a hard timeout.

## Risks and mitigations

### Reconciliation amplification

Risk: noisy temporary-file activity repeatedly scans directories.

Mitigation: coalesce by collection+directory, enumerate only direct children, preserve debounce, and measure/assert batch counts.

### Large directories

Risk: one directory may contain many documents.

Mitigation: remain directory-bounded, reuse eligibility filters, avoid content reads before `syncPaths`, and document/test acceptable behavior for a large fixture.

### Path escape or stale config

Risk: malformed relative paths or config mutation could reconcile outside the intended root.

Mitigation: normalize and prove root containment; resolve work against current collection generation; discard stale queued work.

### Duplicate events and embedding

Risk: the exact path and ambiguous parent event both arrive for one save.

Mitigation: deduplicate exact paths with reconciliation candidates in a single batch and rely on material sync results for notifications/scheduling.

### Cross-platform differences

Risk: macOS, Linux, and Windows report different event types and names.

Mitigation: keep correctness independent of event type/name conventions, inject event sequences in deterministic tests, and keep one real Bun/Linux smoke proof for the reproduced defect.

## Task order

1. Capture watcher event shapes and establish RED regression coverage.
2. Add the smallest bounded directory reconciliation/store seam.
3. Integrate reconciliation into the watcher with config, lifecycle, dedupe, and diagnostics guarantees.
4. Run integrated verification and document any contract-level behavior change.

Implementation begins only after the Flow plan is reviewed and approved. This spec intentionally leaves `plan_review_status` as `unknown` and `ready` as `false` for Daniel's local implementation workflow.
