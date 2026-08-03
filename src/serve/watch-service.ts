import { watch, type FSWatcher } from "node:fs";
import { join, normalize, sep } from "node:path";

import type { Collection } from "../config/types";
import type {
  CollectionSyncResult,
  SyncOptions,
  WalkConfig,
} from "../ingestion";
import type { SqliteAdapter } from "../store/sqlite/adapter";
import type { StoreResult } from "../store/types";
import type { DocumentEvent, DocumentEventBus } from "./doc-events";
import type { EmbedScheduler } from "./embed-scheduler";

import {
  matchesCollectionExclusion,
  normalizeCollectionDirRelPath,
} from "../core/path-rules";
import {
  collectionToWalkConfig,
  defaultSyncService,
  listEligibleDirectChildren,
  matchesWalkPath,
  resolveVanishedPathDirectory,
} from "../ingestion";

export interface CollectionWatchState {
  expectedCollections: string[];
  activeCollections: string[];
  failedCollections: Array<{ collection: string; reason: string }>;
  queuedCollections: string[];
  syncingCollections: string[];
  lastEventAt: string | null;
  lastSyncAt: string | null;
}

/** Why a filesystem event could not name an eligible path directly. */
export type AmbiguousWatchEventReason = "ineligible-path" | "missing-filename";

/** Which half of a bounded reconciliation failed. */
export type ReconciliationStage = "enumerate" | "store" | "sync";

export interface CollectionWatchCallbacks {
  onSyncStart?: (event: { collection: string; relPaths: string[] }) => void;
  onSyncComplete?: (event: {
    collection: string;
    relPaths: string[];
    result: CollectionSyncResult;
  }) => void;
  onSyncError?: (event: {
    collection: string;
    relPaths: string[];
    error: unknown;
  }) => void;
  /** Fires after all watcher syncs and queued paths have settled. */
  onSettled?: () => void;
  /**
   * An event arrived that could not identify an eligible path on its own, so
   * it was treated as a hint about a changed directory (or dropped outright,
   * for a `null`/unusable filename). `directory` is the normalized
   * collection-relative directory the hint was attributed to - `""` is the
   * collection root - and `null` when no directory could be derived.
   *
   * Additive and optional: existing consumers compile unchanged.
   */
  onAmbiguousEvent?: (event: {
    collection: string;
    directory: string | null;
    reason: AmbiguousWatchEventReason;
  }) => void;
  /** A bounded reconciliation of one directory is about to run. */
  onReconcileStart?: (event: { collection: string; directory: string }) => void;
  /**
   * A directory reconciled successfully. `candidateCount` is what the disk and
   * indexed sides produced for this directory; `syncedCount` is how many of
   * those survived the live-rules recheck and reached the `syncPaths` batch.
   */
  onReconcileComplete?: (event: {
    collection: string;
    directory: string;
    candidateCount: number;
    syncedCount: number;
  }) => void;
  /** A reconciliation stage failed. Nothing is inferred from a failed stage. */
  onReconcileFailed?: (event: {
    collection: string;
    directory: string | null;
    stage: ReconciliationStage;
    cause: unknown;
  }) => void;
}

/**
 * The queued dirty-directory work for ONE affected directory.
 *
 * Work is keyed by affected directory - the directory portion of the reported
 * path - so repeated events inside one directory collapse into one unit of work
 * no matter how many distinct filenames they name.
 *
 * `hints` keeps the reported paths themselves as candidate directories, which
 * is what makes R12 work: a recursive delete reports only the bare directory
 * (`dir1`), and its indexed documents are direct children of THAT path, not of
 * its parent. Resolution order is unchanged - a hint resolves first, and the
 * affected directory is the fallback when the hint yields nothing.
 *
 * `hints` is deliberately UNBOUNDED. An earlier revision capped it, which was
 * the wrong lever: at queue time a dead temp name and a recursively deleted
 * directory are the same thing - a name that no longer exists - so a cap that
 * drops "probably a temp file" can drop the one hint that was a deletion, and
 * R12 fails outright with no signal. What made a cap tempting was the per-hint
 * COST, and that is now gone: the whole hint set is discriminated in ONE
 * batched store lookup per flush, and the disk is enumerated only for hints
 * that the indexed side proved are real directories. What remains is a Set of
 * short strings living for at most one 300 ms debounce window.
 *
 * Only the root is stamped at queue time. Resolution is ALWAYS performed
 * against the current collection configuration, so a generation stamp would
 * change nothing about filters, patterns, or sync options; a changed ROOT is
 * the one drift that makes the queued area meaningless rather than stale.
 */
interface DirtyDirectoryEntry {
  /** `normalize(collection.path)` when the first event for this key arrived. */
  root: string;
  /** Reported paths under this directory, as candidate directories. */
  hints: Set<string>;
  /**
   * This directory was OBSERVED missing on disk when the event was classified,
   * so its whole indexed subtree is implicated - not just its direct children.
   *
   * Carried on the queue rather than re-derived at enumeration time on purpose.
   * Between classification and enumeration the directory can be RECREATED (an
   * editor that deletes and rewrites a tree, a checkout, a restore), and a
   * second filesystem observation would then quietly narrow a subtree removal
   * back to direct children, stranding everything nested below it. The
   * classification is the intent; the later enumeration only supplies the disk
   * side of the union. Nothing unsafe follows from keeping it: every candidate
   * still goes through `syncPaths`, which stats each path and reactivates the
   * ones that came back.
   */
  subtree: boolean;
}

/** Outcome of reconciling one directory. */
interface DirectoryReconciliation {
  directory: string;
  candidates: string[];
  /**
   * The disk enumeration itself failed (unreadable directory). Distinct from a
   * store failure: an unreadable directory must not be re-interpreted as its
   * parent's problem, while a store failure still allows the parent fallback
   * because no deactivation is ever inferred from a failed store query.
   */
  enumerationFailed: boolean;
  /**
   * `#reconcileDirectory` ran for this directory, so `onReconcileStart` was
   * emitted and it owes EXACTLY ONE terminal outcome (R7). A directory the
   * current rules reject is never started and owes nothing.
   */
  started: boolean;
  /**
   * A terminal `onReconcileFailed` was already emitted for this directory
   * (enumerate or store stage). It must not also be reported as completed, and
   * a later sync-stage failure must not report it twice.
   */
  failureReported: boolean;
}

/** The directory portion of a normalized collection-relative path. */
function parentDirectoryOf(relPath: string): string {
  const lastSlash = relPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

interface CollectionWatchServiceOptions {
  collections: Collection[];
  store: SqliteAdapter;
  scheduler: EmbedScheduler | null;
  eventBus?: DocumentEventBus | null;
  callbacks?: CollectionWatchCallbacks;
  syncOptions?: SyncOptions;
  watchFactory?: typeof watch;
  /**
   * Seam for the flush-time classification `stat` of a reported exact path,
   * defaulting to the real filesystem implementation. Injected for the same
   * reason as `watchFactory`: the classification is an `await` inside the
   * flush, and drift behavior in that window is only testable if a test can
   * act at exactly that point.
   */
  resolveVanishedPath?: typeof resolveVanishedPathDirectory;
}

function watcherCollectionFingerprint(
  collection: Collection,
  syncOptions: SyncOptions
): string {
  return JSON.stringify({
    path: normalize(collection.path),
    pattern: collection.pattern,
    include: collection.include,
    exclude: collection.exclude,
    languageHint: collection.languageHint ?? null,
    recordAdapters: collection.recordAdapters ?? null,
    limits: syncOptions.limits ?? null,
    concurrency: syncOptions.concurrency ?? null,
    contentTypeRules: syncOptions.contentTypeRules ?? null,
    contentTypeRulesFingerprint:
      syncOptions.contentTypeRulesFingerprint ?? null,
    projectTypedEdges: syncOptions.projectTypedEdges ?? null,
  });
}

function changedPaths(
  result: CollectionSyncResult,
  fallbackPaths: string[] = []
): string[] {
  if (result.files) {
    return result.files
      .filter((file) => file.status === "added" || file.status === "updated")
      .map((file) => file.relPath);
  }
  return result.filesAdded + result.filesUpdated + result.filesMarkedInactive >
    0
    ? fallbackPaths
    : [];
}

/**
 * Which contributed paths a resolved sync actually failed on.
 *
 * `files` is the authoritative per-path record and is what `syncPaths` always
 * returns; `errors` carries the typed-edge projection failures, which name a
 * `relPath` too. When a result reports failures with NO per-path detail
 * (`files` omitted, `filesErrored > 0`), the failure cannot be attributed, so
 * the caller fails closed and treats every contributing directory as failed
 * rather than claiming success it cannot evidence.
 */
function syncErrorAttribution(result: CollectionSyncResult): {
  paths: ReadonlySet<string>;
  attributable: boolean;
} {
  const paths = new Set<string>();
  for (const error of result.errors) {
    paths.add(error.relPath);
  }
  if (result.files) {
    for (const file of result.files) {
      if (file.status === "error") {
        paths.add(file.relPath);
      }
    }
    return { paths, attributable: true };
  }
  return { paths, attributable: result.filesErrored === 0 };
}

export class CollectionWatchService {
  #collections: Collection[];
  readonly #store: SqliteAdapter;
  readonly #scheduler: EmbedScheduler | null;
  readonly #eventBus: DocumentEventBus | null;
  readonly #callbacks: CollectionWatchCallbacks | null;
  #syncOptions: SyncOptions;
  readonly #watchers = new Map<string, FSWatcher>();
  readonly #watchRoots = new Map<string, string>();
  readonly #collectionGenerations = new Map<string, number>();
  readonly #collectionFingerprints = new Map<string, string>();
  readonly #pendingByCollection = new Map<string, Set<string>>();
  readonly #dirtyByCollection = new Map<
    string,
    Map<string, DirtyDirectoryEntry>
  >();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #syncing = new Set<string>();
  readonly #inFlightSyncs = new Set<Promise<void>>();
  readonly #suppressedPaths = new Map<string, number>();
  readonly #watchFactory: typeof watch;
  readonly #resolveVanishedPath: typeof resolveVanishedPathDirectory;
  readonly #failedCollections = new Map<string, string>();
  #nextCollectionGeneration = 0;
  #disposed = false;
  #lastEventAt: string | null = null;
  #lastSyncAt: string | null = null;

  constructor(options: CollectionWatchServiceOptions) {
    this.#collections = options.collections;
    this.#store = options.store;
    this.#scheduler = options.scheduler;
    this.#eventBus = options.eventBus ?? null;
    this.#callbacks = options.callbacks ?? null;
    this.#syncOptions = options.syncOptions ?? {};
    this.#watchFactory = options.watchFactory ?? watch;
    this.#resolveVanishedPath =
      options.resolveVanishedPath ?? resolveVanishedPathDirectory;
  }

  start(): void {
    if (this.#disposed) {
      return;
    }
    this.updateCollections(this.#collections);
  }

  updateCollections(
    collections: Collection[],
    syncOptions?: SyncOptions
  ): void {
    if (this.#disposed) {
      return;
    }
    if (syncOptions) {
      this.#syncOptions = syncOptions;
    }
    const nextByName = new Map(
      collections.map((collection) => [collection.name, collection])
    );

    for (const [collectionName, watcher] of this.#watchers) {
      const nextCollection = nextByName.get(collectionName);
      const nextRoot = nextCollection
        ? normalize(nextCollection.path)
        : undefined;
      if (
        nextRoot === undefined ||
        nextRoot !== this.#watchRoots.get(collectionName)
      ) {
        watcher.close();
        this.#watchers.delete(collectionName);
        this.#watchRoots.delete(collectionName);
        this.#failedCollections.delete(collectionName);
        this.#pendingByCollection.delete(collectionName);
        // A removed collection or a moved root must never flush queued
        // reconciliation work against the new configuration (R6).
        this.#dirtyByCollection.delete(collectionName);
        const timer = this.#timers.get(collectionName);
        if (timer) {
          clearTimeout(timer);
          this.#timers.delete(collectionName);
        }
      }
    }

    for (const collectionName of this.#collectionFingerprints.keys()) {
      if (!nextByName.has(collectionName)) {
        this.#collectionFingerprints.delete(collectionName);
        this.#collectionGenerations.set(
          collectionName,
          ++this.#nextCollectionGeneration
        );
      }
    }

    this.#collections = collections;
    for (const collection of collections) {
      const fingerprint = watcherCollectionFingerprint(
        collection,
        this.#syncOptions
      );
      if (this.#collectionFingerprints.get(collection.name) !== fingerprint) {
        this.#collectionFingerprints.set(collection.name, fingerprint);
        this.#collectionGenerations.set(
          collection.name,
          ++this.#nextCollectionGeneration
        );
      }
    }

    for (const collection of this.#collections) {
      if (this.#watchers.has(collection.name)) {
        continue;
      }
      try {
        const watchedRoot = normalize(collection.path);
        const watcher = this.#watchFactory(
          collection.path,
          { recursive: true },
          (_eventType, filename) => {
            if (this.#disposed) return;
            // A `null`/empty filename (Bun queue overflow, oven-sh/bun#33110)
            // carries no directory hint at all. It is dropped without recovery,
            // but it must be visible and it must never throw (R9).
            if (!filename) {
              this.#notifyAmbiguous(collection.name, null, "missing-filename");
              return;
            }
            const relPath = filename.toString().replaceAll("\\", "/");
            const currentCollection = this.#collections.find(
              (entry) => entry.name === collection.name
            );
            if (
              !currentCollection ||
              normalize(currentCollection.path) !== watchedRoot
            ) {
              return;
            }
            if (
              matchesWalkPath(
                relPath,
                collectionToWalkConfig(currentCollection, 0)
              )
            ) {
              // Exact-path fast path: unchanged behavior, no directory work.
              const fullPath = normalize(join(watchedRoot, relPath));
              const suppressedUntil = this.#suppressedPaths.get(fullPath);
              if (suppressedUntil && suppressedUntil > Date.now()) {
                return;
              }
              this.#lastEventAt = new Date().toISOString();
              this.#queueChange(collection.name, relPath);
              return;
            }
            this.#queueDirtyDirectory(currentCollection, watchedRoot, relPath);
          }
        );
        this.#watchers.set(collection.name, watcher);
        this.#watchRoots.set(collection.name, watchedRoot);
        this.#failedCollections.delete(collection.name);
      } catch (error) {
        this.#failedCollections.set(
          collection.name,
          error instanceof Error ? error.message : "watch unavailable"
        );
      }
    }
  }

  suppress(absPath: string, ms = 5_000): void {
    this.#suppressedPaths.set(normalize(absPath), Date.now() + ms);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    for (const watcher of this.#watchers.values()) {
      watcher.close();
    }
    this.#timers.clear();
    this.#watchers.clear();
    this.#watchRoots.clear();
    this.#collectionGenerations.clear();
    this.#collectionFingerprints.clear();
    this.#collections = [];
    this.#pendingByCollection.clear();
    this.#dirtyByCollection.clear();
    await Promise.allSettled(this.#inFlightSyncs);
    this.#syncing.clear();
  }

  getState(): CollectionWatchState {
    return {
      expectedCollections: this.#collections.map(
        (collection) => collection.name
      ),
      activeCollections: [...this.#watchers.keys()],
      failedCollections: [...this.#failedCollections.entries()].map(
        ([collection, reason]) => ({ collection, reason })
      ),
      queuedCollections: [
        ...new Set([
          ...[...this.#pendingByCollection.entries()]
            .filter(([, relPaths]) => relPaths.size > 0)
            .map(([collectionName]) => collectionName),
          ...[...this.#dirtyByCollection.entries()]
            .filter(([, directories]) => directories.size > 0)
            .map(([collectionName]) => collectionName),
        ]),
      ],
      syncingCollections: [...this.#syncing],
      lastEventAt: this.#lastEventAt,
      lastSyncAt: this.#lastSyncAt,
    };
  }

  #queueChange(collectionName: string, relPath: string): void {
    if (this.#disposed) {
      return;
    }
    const pending =
      this.#pendingByCollection.get(collectionName) ?? new Set<string>();
    pending.add(relPath);
    this.#pendingByCollection.set(collectionName, pending);
    this.#armFlushTimer(collectionName);
  }

  /**
   * Run a diagnostic observer so it can never influence control flow (R9).
   *
   * `onAmbiguousEvent` fires synchronously inside the `fs.watch` callback,
   * before any work is queued. A throwing consumer would otherwise propagate
   * out of the watcher callback AND - on the ineligible-path branch - stop the
   * reconciliation from ever being queued. Diagnostics are observations; a
   * broken observer is not the watcher's problem.
   */
  #notifyDiagnostic(run: () => void): void {
    try {
      run();
    } catch {
      // Intentionally swallowed: see the doc comment above.
      return;
    }
  }

  #notifyAmbiguous(
    collectionName: string,
    directory: string | null,
    reason: AmbiguousWatchEventReason
  ): void {
    this.#notifyDiagnostic(() =>
      this.#callbacks?.onAmbiguousEvent?.({
        collection: collectionName,
        directory,
        reason,
      })
    );
  }

  /**
   * Queue the dirty-directory work implied by an ambiguous event.
   *
   * Work is keyed by the AFFECTED DIRECTORY, and the reported path is retained
   * as a bounded directory hint under that key, because measurement (fn-114
   * task .1, Bun 1.3.11 on Linux) showed neither alone is sufficient:
   *
   * - an atomic save through a plain temp name reports ONLY the temp source
   *   (`note.md.tmp`), so the real file is a SIBLING - the directory is needed;
   * - a recursive directory delete reports ONLY the bare directory (`dir1`)
   *   with no child events, and its indexed documents are direct children of
   *   that directory - the reported path ITSELF is needed (R12).
   *
   * The reported path cannot be stat-ed in the deletion case (it is already
   * gone), so it is recorded as a hint and resolved at flush time: a hint that
   * is not a directory enumerates as `missing` and reconciles against the
   * indexed side only, which is exactly the deletion behavior.
   *
   * Keying by directory is what bounds the WORK. 25 events naming 25 distinct
   * temp files in one directory queue 25 hints, but those 25 hints cost one
   * batched store lookup and zero directory enumerations at flush time (see
   * `#reconcileDirtyDirectories`); only the one affected directory is
   * enumerated. Retaining every hint is what keeps a deleted directory - which
   * is indistinguishable from a dead temp name until the indexed side is
   * consulted - from being silently discarded.
   */
  #queueDirtyDirectory(
    collection: Collection,
    watchedRoot: string,
    relPath: string
  ): void {
    if (this.#disposed) {
      return;
    }
    const reported = normalizeCollectionDirRelPath(relPath);
    this.#notifyAmbiguous(
      collection.name,
      reported === null ? null : parentDirectoryOf(reported),
      "ineligible-path"
    );
    if (reported === null) {
      // Escapes the collection root - refuse it rather than reconcile blind.
      return;
    }
    const directory = parentDirectoryOf(reported);
    const reportedIsReconcilable = this.#isReconcilableDirectory(
      reported,
      collection
    );
    if (
      !reportedIsReconcilable &&
      !this.#isReconcilableDirectory(directory, collection)
    ) {
      return;
    }

    const dirty =
      this.#dirtyByCollection.get(collection.name) ??
      new Map<string, DirtyDirectoryEntry>();
    let entry = dirty.get(directory);
    if (!entry || entry.root !== watchedRoot) {
      // A root change mid-window invalidates whatever was queued for this key.
      // `subtree` starts false: an ineligible reported path is not evidence
      // that its PARENT directory went anywhere, and the hint machinery below
      // is what discovers a removed directory on this route.
      entry = { root: watchedRoot, hints: new Set(), subtree: false };
      dirty.set(directory, entry);
    }
    // An excluded or dot-prefixed reported path is not retained: a full sync
    // would never walk it either, so it is covered by the directory alone.
    this.#addDirectoryHint(entry, collection, reported);
    this.#dirtyByCollection.set(collection.name, dirty);
    this.#armFlushTimer(collection.name);
  }

  /**
   * Cheap queue/flush-time noise filter. Authoritative eligibility still runs
   * per candidate path through `matchesWalkPath`; this only avoids doing
   * filesystem and store work for directories a full `gno update` would never
   * walk at all (dot-prefixed) or that the collection excludes outright.
   */
  #isReconcilableDirectory(directory: string, collection: Collection): boolean {
    if (directory === "") {
      return true;
    }
    if (directory.split("/").some((segment) => segment.startsWith("."))) {
      return false;
    }
    return !matchesCollectionExclusion(directory, collection.exclude);
  }

  #armFlushTimer(collectionName: string): void {
    const existingTimer = this.#timers.get(collectionName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this.#timers.set(
      collectionName,
      setTimeout(() => {
        this.#startFlush(collectionName);
      }, 300)
    );
  }

  #startFlush(collectionName: string): void {
    if (this.#disposed) {
      return;
    }
    const sync = this.#flushCollection(collectionName);
    this.#inFlightSyncs.add(sync);
    void sync
      .finally(() => {
        this.#inFlightSyncs.delete(sync);
      })
      .catch(() => undefined);
  }

  async #flushCollection(collectionName: string): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const pending = this.#pendingByCollection.get(collectionName);
    const dirty = this.#dirtyByCollection.get(collectionName);
    if ((pending?.size ?? 0) === 0 && (dirty?.size ?? 0) === 0) {
      return;
    }
    if (this.#syncing.has(collectionName)) {
      return;
    }

    const collection = this.#collections.find(
      (entry) => entry.name === collectionName
    );
    if (!collection) {
      this.#pendingByCollection.delete(collectionName);
      this.#dirtyByCollection.delete(collectionName);
      return;
    }

    let exactPaths = pending ? [...pending] : [];
    let dirtyEntries = dirty ? [...dirty.entries()] : [];
    let syncGeneration = this.#collectionGenerations.get(collectionName) ?? 0;
    this.#pendingByCollection.set(collectionName, new Set<string>());
    this.#dirtyByCollection.set(
      collectionName,
      new Map<string, DirtyDirectoryEntry>()
    );

    // Claim the collection before the (async) reconciliation so a concurrent
    // debounce flush cannot start work against the same queues mid-await.
    this.#syncing.add(collectionName);
    let relPaths: string[] = [];
    let reconciliations: DirectoryReconciliation[] = [];
    // Started reconciliations that still owe their single terminal outcome.
    let outstanding: DirectoryReconciliation[] = [];

    /**
     * R6 - the ONE resume point every pre-sync await funnels through.
     *
     * Everything between draining the queues and handing paths to `syncPaths`
     * was resolved against the configuration captured in `collection` and
     * `syncGeneration`. Every `await` in that region is a window in which
     * `updateCollections` can remove the collection, move its root, or change
     * its rules, so the work in hand can describe a configuration that no
     * longer exists.
     *
     * This deliberately runs UNCONDITIONALLY after each such await instead of
     * inside whichever branch happens to own the current one. The earlier
     * revision guarded only the enumeration branch; adding the classification
     * await (`#widenVanishedExactPaths`) then silently reopened exactly the
     * same hole for a batch of exact paths with no dirty directories, because
     * that batch never enters the enumeration branch at all. The rule is
     * therefore mechanical, not situational: an `await` added below MUST be
     * followed immediately by `resumeAfterAwait()`, and no branch condition may
     * stand between them.
     *
     * Dropping the resolved work on drift is safe because the recovery loop at
     * the end of the flush runs a full `syncCollection` against the CURRENT
     * configuration, which is a superset of anything bounded that was dropped
     * (R6) - reconciliation adds no second compensating pass.
     */
    const resumeAfterAwait = (): "continue" | "abort" => {
      if (this.#disposed) {
        return "abort";
      }
      const liveCollection = this.#collections.find(
        (entry) => entry.name === collectionName
      );
      const liveGeneration =
        this.#collectionGenerations.get(collectionName) ?? 0;
      if (liveCollection) {
        const rootChanged =
          normalize(liveCollection.path) !== normalize(collection.path);
        if (!(rootChanged || liveGeneration !== syncGeneration)) {
          return "continue";
        }
      }
      // Any drift invalidates the whole in-hand batch - bounded candidates and
      // the exact paths drained from the same window alike. They are synced
      // against neither the old nor the new configuration.
      this.#completeReconciliations(collection.name, outstanding, new Set());
      outstanding = [];
      reconciliations = [];
      dirtyEntries = [];
      exactPaths = [];
      if (!liveCollection) {
        // The collection is gone: there is nothing left to recover against, so
        // the queues are discarded rather than reflushed.
        this.#pendingByCollection.delete(collectionName);
        this.#dirtyByCollection.delete(collectionName);
        return "abort";
      }
      return "continue";
    };

    try {
      if (exactPaths.length > 0) {
        dirtyEntries = await this.#widenVanishedExactPaths(
          collection,
          exactPaths,
          dirtyEntries
        );
        if (resumeAfterAwait() === "abort") {
          return;
        }
      }

      if (dirtyEntries.length > 0) {
        reconciliations = await this.#reconcileDirtyDirectories(
          collection,
          dirtyEntries
        );
        // Assigned BEFORE the resume check so a drift-dropped batch still
        // settles the terminal outcome every started reconciliation owes (R7).
        outstanding = reconciliations;
        if (resumeAfterAwait() === "abort") {
          return;
        }
      }

      // Reconciliation candidates rejoin the ordinary path flow here, BEFORE
      // the live-rules recheck, so they are filtered exactly like exact paths.
      relPaths = [
        ...new Set([
          ...exactPaths,
          ...reconciliations.flatMap((entry) => entry.candidates),
        ]),
      ].filter((relPath) =>
        matchesWalkPath(relPath, collectionToWalkConfig(collection, 0))
      );
      const batched = new Set(relPaths);
      // A reconciliation that put nothing into the batch cannot be affected by
      // the sync stage, so its outcome is already known: report the successful
      // no-op now (a zero-candidate reconciliation IS a success and must not
      // vanish). Everything that DID contribute waits for the shared sync, so a
      // sync failure is never preceded by a completion for the same directory.
      const contributing: DirectoryReconciliation[] = [];
      const settledNow: DirectoryReconciliation[] = [];
      for (const entry of outstanding) {
        if (entry.candidates.some((relPath) => batched.has(relPath))) {
          contributing.push(entry);
        } else {
          settledNow.push(entry);
        }
      }
      this.#completeReconciliations(collection.name, settledNow, batched);
      outstanding = contributing;

      let completionCollection = collection;
      let completionPaths: string[] = [];
      if (relPaths.length === 0) {
        // An empty batch is NOT automatically "nothing to do": the enumeration
        // above is async, so the configuration may have changed while it ran,
        // and the old rules can legitimately yield nothing under the new ones
        // (`*.md` -> `*.txt`). Falling straight through to `return` here would
        // skip the generation-drift recovery below and leave newly eligible
        // files undiscovered. Only an UNDRIFTED empty batch is a no-op.
        if (
          (this.#collectionGenerations.get(collectionName) ?? 0) ===
          syncGeneration
        ) {
          // `finally` announces settling; nothing to sync.
          return;
        }
      } else {
        this.#callbacks?.onSyncStart?.({
          collection: collection.name,
          relPaths,
        });
        const result = await defaultSyncService.syncPaths(
          collection,
          this.#store,
          relPaths,
          {
            ...this.#syncOptions,
            runUpdateCmd: false,
          }
        );
        if (this.#disposed) {
          return;
        }
        this.#callbacks?.onSyncComplete?.({
          collection: collection.name,
          relPaths,
          result,
        });
        // The shared sync RESOLVED, which is not the same as "every contributed
        // path succeeded": `syncPaths` reports ordinary per-file failures
        // (EACCES, a converter error, a failed `markInactive`) in its result
        // rather than by throwing. Each contributing directory is settled
        // against that result, so a directory whose own paths errored reports
        // a sync-stage FAILURE instead of a completion (R7). Reported here
        // rather than before the sync so a later throw cannot produce both
        // "completed" and "failed" for the same reconciliation.
        this.#settleReconciliationsAfterSync(
          collection.name,
          outstanding,
          batched,
          result
        );
        outstanding = [];
        completionPaths = changedPaths(result, relPaths);
      }

      while (true) {
        const currentCollection = this.#collections.find(
          (entry) => entry.name === collectionName
        );
        if (!currentCollection) {
          break;
        }
        const currentGeneration =
          this.#collectionGenerations.get(collectionName) ?? 0;
        if (currentGeneration === syncGeneration) {
          const currentRelPaths =
            normalize(currentCollection.path) ===
            normalize(completionCollection.path)
              ? completionPaths.filter((relPath) =>
                  matchesWalkPath(
                    relPath,
                    collectionToWalkConfig(currentCollection, 0)
                  )
                )
              : [];
          if (currentRelPaths.length > 0) {
            this.#afterSync(currentCollection, currentRelPaths);
          }
          break;
        }

        const recoveryResult = await defaultSyncService.syncCollection(
          currentCollection,
          this.#store,
          {
            ...this.#syncOptions,
            runUpdateCmd: false,
          }
        );
        if (this.#disposed) {
          return;
        }
        completionCollection = currentCollection;
        completionPaths = changedPaths(recoveryResult);
        syncGeneration = currentGeneration;
        this.#callbacks?.onSyncComplete?.({
          collection: currentCollection.name,
          relPaths: completionPaths,
          result: recoveryResult,
        });
      }
    } catch (error) {
      if (this.#disposed) {
        return;
      }
      this.#callbacks?.onSyncError?.({
        collection: collection.name,
        relPaths,
        error,
      });
      // Only directories that actually reached the failed sync are reported
      // against it, and only if they do not already own a terminal outcome.
      for (const entry of outstanding) {
        if (entry.failureReported) {
          continue;
        }
        this.#notifyDiagnostic(() =>
          this.#callbacks?.onReconcileFailed?.({
            collection: collection.name,
            directory: entry.directory,
            stage: "sync",
            cause: error,
          })
        );
      }
      throw error;
    } finally {
      this.#syncing.delete(collectionName);
      if (!this.#disposed) {
        const remainingPaths = this.#pendingByCollection.get(collectionName);
        const remainingDirs = this.#dirtyByCollection.get(collectionName);
        if ((remainingPaths?.size ?? 0) > 0 || (remainingDirs?.size ?? 0) > 0) {
          this.#startFlush(collectionName);
        } else {
          this.#notifySettledIfIdle();
        }
      }
    }
  }

  /**
   * Emit the single completion each started reconciliation owes (R7).
   *
   * Every directory that emitted `onReconcileStart` must reach exactly ONE
   * terminal outcome - completion or failure, never both and never neither:
   *
   * - a directory that already reported a failed stage is skipped here, so a
   *   fail-closed enumeration or an unanswered store query is not also claimed
   *   as a success;
   * - a successful reconciliation that produced nothing IS reported, with zero
   *   counts. Dropping it (as an earlier revision did, by filtering empty
   *   outcomes away) left `onReconcileStart` with no answer at all, which is
   *   precisely the diagnostic ambiguity R7 exists to prevent.
   *
   * Disposal remains the one documented exception: no callback fires after
   * `dispose()`, for reconciliation as for every other watcher event.
   */
  /**
   * Settle every contributing reconciliation against the RESULT of a sync that
   * resolved without throwing.
   *
   * `syncPaths` reports ordinary per-file failures in its result instead of
   * rejecting, so "the promise resolved" is not evidence that the contributed
   * paths were indexed. Reporting completion unconditionally made a directory
   * whose documents are now stale indistinguishable in the daemon log from one
   * that reconciled cleanly - exactly the ambiguity R7 exists to remove.
   *
   * Attribution is PER DIRECTORY, not per batch: several directories share one
   * `syncPaths` call, and one directory's `EACCES` says nothing about another's
   * paths. A directory fails only when a path IT contributed errored; its
   * neighbours in the same batch still complete normally. The exactly-one
   * terminal outcome invariant is preserved by marking `failureReported` before
   * emitting, and by routing the survivors through `#completeReconciliations`.
   */
  #settleReconciliationsAfterSync(
    collectionName: string,
    entries: DirectoryReconciliation[],
    batched: ReadonlySet<string>,
    result: CollectionSyncResult
  ): void {
    const attribution = syncErrorAttribution(result);
    const completed: DirectoryReconciliation[] = [];
    for (const entry of entries) {
      if (entry.failureReported) {
        continue;
      }
      const contributed = entry.candidates.filter((relPath) =>
        batched.has(relPath)
      );
      const failedPaths = attribution.attributable
        ? contributed.filter((relPath) => attribution.paths.has(relPath))
        : contributed;
      if (failedPaths.length === 0) {
        completed.push(entry);
        continue;
      }
      entry.failureReported = true;
      const cause = new Error(
        `sync reported ${failedPaths.length} failed path(s) for directory "${entry.directory}": ${failedPaths.join(", ")}`
      );
      this.#notifyDiagnostic(() =>
        this.#callbacks?.onReconcileFailed?.({
          collection: collectionName,
          directory: entry.directory,
          stage: "sync",
          cause,
        })
      );
    }
    this.#completeReconciliations(collectionName, completed, batched);
  }

  #completeReconciliations(
    collectionName: string,
    entries: DirectoryReconciliation[],
    batched: ReadonlySet<string>
  ): void {
    for (const entry of entries) {
      if (entry.failureReported) {
        continue;
      }
      this.#notifyDiagnostic(() =>
        this.#callbacks?.onReconcileComplete?.({
          collection: collectionName,
          directory: entry.directory,
          candidateCount: entry.candidates.length,
          syncedCount: entry.candidates.filter((relPath) =>
            batched.has(relPath)
          ).length,
        })
      );
    }
  }

  /**
   * Widen the exact-path batch wherever the DISK says the event was not a
   * complete report.
   *
   * The original design read an event naming an eligible path as authoritative.
   * That is provably wrong for deletions. Measured on Bun 1.3.14 (Linux, ext4,
   * real inotify), a recursive delete of `dir1/` holding `a.md` and `b.md`
   * reports ONE ARBITRARY child - `dir1/b.md` on hardware, `dir1/a.md` in a
   * container - and nothing else. That path is eligible, so it took the
   * exact-path fast path, no reconciliation ran, and every unnamed sibling
   * stayed active forever. Bun 1.3.11 reported the bare directory instead. The
   * event SHAPE is not stable across Bun patch releases, so it cannot be the
   * thing correctness rests on.
   *
   * The disk is. A path that still exists named a real, complete change - the
   * live-edit hot path stays exactly as narrow as before, at the cost of one
   * `stat` per pending path. A path that has VANISHED is treated as one sample
   * of a larger removal: its shallowest removed ancestor (or its surviving
   * parent directory, when only the file went) is queued as dirty, and the
   * ordinary bounded reconciliation takes it from there.
   *
   * Where the DIRECTORY-VS-FILE decision is made
   * --------------------------------------------
   * An eligible reported name is NOT evidence that the thing it named was a
   * file. `archive.md` is a legal DIRECTORY name, and a `*.md` collection
   * pattern matches it exactly as it matches a document, so an event naming
   * the bare `archive.md` takes the exact-path route while `archive.md/child.md`
   * lives beneath it. `matchesWalkPath` is deliberately filesystem-free and
   * cannot tell the two apart, and once the path has vanished neither can the
   * disk. Collapsing it to its surviving parent on the strength of the NAME
   * left every document under `archive.md/` active and searchable forever -
   * the same silent staleness this whole path exists to remove.
   *
   * So the name decides nothing here. A vanished path whose parent SURVIVED is
   * queued as a directory HINT under that parent, and the decision is deferred
   * to the one place that can actually make it: the indexed-descendant
   * discriminator in `#reconcileDirtyDirectories`. A hint with active indexed
   * descendants was a directory and is reconciled as a removed subtree; a hint
   * with none was an ordinary file and collapses to the surviving parent,
   * exactly as before. This costs no per-path store query - the hint joins the
   * flush's single batched descendant lookup, which is the same seam the
   * ineligible-event route has always used.
   *
   * Nothing is dropped: the exact paths stay in the batch either way, so a
   * plain single-file delete still deactivates exactly that file through the
   * existing `syncPaths` ENOENT branch.
   */
  async #widenVanishedExactPaths(
    collection: Collection,
    exactPaths: string[],
    dirtyEntries: Array<[string, DirtyDirectoryEntry]>
  ): Promise<Array<[string, DirtyDirectoryEntry]>> {
    const root = normalize(collection.path);
    const byDirectory = new Map(dirtyEntries);
    for (const relPath of exactPaths) {
      if (this.#disposed) {
        break;
      }
      const outcome = await this.#resolveVanishedPath(relPath, root);
      if (outcome.status !== "removed") {
        // `present` is the hot path; `error` fails closed - an unreadable disk
        // is never read as "the file is gone".
        continue;
      }
      let entry = byDirectory.get(outcome.directory);
      if (entry) {
        // The classification is recorded on the queue, never re-derived later:
        // one removed-directory sample in this window is enough, and a second
        // path that only says "my parent survived" must not clear it.
        entry.subtree ||= outcome.directoryRemoved;
      } else {
        entry = {
          root,
          hints: new Set<string>(),
          subtree: outcome.directoryRemoved,
        };
        byDirectory.set(outcome.directory, entry);
      }
      if (!outcome.directoryRemoved) {
        // The vanished path's own parent survived, so the path itself is the
        // shallowest thing known to be gone - and it may be a directory whose
        // name merely looks like a file. Retain it as a hint so the indexed
        // side, not the name, decides which it was. When the ancestor walk
        // already OBSERVED a removed directory (`directoryRemoved`), that
        // directory is the queued area and the discriminator is not needed.
        this.#addDirectoryHint(entry, collection, relPath);
      }
    }
    return [...byDirectory];
  }

  /**
   * Retain a reported path as a candidate removed directory under its queued
   * entry. Shared by both routes into the dirty queue so a hint means exactly
   * the same thing however the event arrived.
   *
   * A path the current rules would never walk is not retained: a full
   * `gno update` would not descend into it either, so the directory alone
   * covers it and the flush's batched lookups are not widened for it.
   */
  #addDirectoryHint(
    entry: DirtyDirectoryEntry,
    collection: Collection,
    relPath: string
  ): void {
    const reported = normalizeCollectionDirRelPath(relPath);
    if (
      reported === null ||
      reported === "" ||
      !this.#isReconcilableDirectory(reported, collection)
    ) {
      return;
    }
    entry.hints.add(reported);
  }

  /**
   * Resolve queued dirty directories into concrete candidate relative paths.
   *
   * The discriminator, and why it is batched
   * ----------------------------------------
   * A retained hint is a reported path that no longer names an eligible file.
   * On disk it is indistinguishable from any other vanished name, but the two
   * cases it can be demand opposite work:
   *
   * - a dead temp source (`note.md.tmp`) - the real change is a SIBLING, so the
   *   affected DIRECTORY is what must be reconciled;
   * - a recursively deleted directory (`dir1`) - its indexed documents are
   *   direct children of the hint itself, and reconciling the parent can never
   *   reach them (R12).
   *
   * The INDEXED side is what tells them apart: a deleted directory has active
   * indexed children, a dead temp file does not. That question is asked for
   * EVERY hint of this flush in ONE batched store lookup, so unique-temp-name
   * churn costs one query for the window instead of one per filename. Only
   * hints the store proved are real indexed directories are then enumerated on
   * disk, so the enumeration count tracks affected directories rather than
   * event count.
   *
   * A hint with no active indexed children is read as "a file changed here" and
   * falls back to the affected directory - exactly as before. Note what is NOT
   * done: such a hint is not speculatively enumerated on the chance that it is
   * a brand-new subdirectory. On linux (fn-114 task .1) a `mkdir` is reported
   * while the directory is still EMPTY and the writes that follow inside it are
   * never reported at all, so that enumeration finds nothing on the one
   * platform where it would be the only chance; on macOS the files inside
   * produce their own eligible events and take the exact-path fast path.
   *
   * A hint that resolves to real work IS the affected area, so the directory is
   * not enumerated for it - that keeps a recursive directory delete from
   * dragging every unchanged sibling of the deleted directory into the batch.
   *
   * Generation drift is handled BEFORE enumeration (R6): an entry queued
   * against a different root is dropped, and everything else is re-resolved
   * against the CURRENT collection configuration. Drift that appears during
   * enumeration or while `syncPaths` is in flight is deliberately left to the
   * pre-existing full-`syncCollection` recovery loop below, which is a superset
   * of this bounded work - reconciliation adds no second compensating pass.
   */
  async #reconcileDirtyDirectories(
    collection: Collection,
    entries: Array<[string, DirtyDirectoryEntry]>
  ): Promise<DirectoryReconciliation[]> {
    const currentRoot = normalize(collection.path);
    const walkConfig = collectionToWalkConfig(collection, 0);
    const resolved = new Map<string, DirectoryReconciliation>();

    // The collection moved after these events were queued: the queued areas no
    // longer exist in the current configuration.
    const live = entries.filter(([, entry]) => entry.root === currentRoot);

    // Every key the flush could need an indexed answer for, resolved in one
    // round trip. Re-filtered against the CURRENT rules, so a directory the
    // configuration started excluding mid-window is never even asked about.
    const lookupKeys = new Set<string>();
    for (const [directory, entry] of live) {
      if (this.#isReconcilableDirectory(directory, collection)) {
        lookupKeys.add(directory);
      }
      for (const hint of entry.hints) {
        if (this.#isReconcilableDirectory(hint, collection)) {
          lookupKeys.add(hint);
        }
      }
    }
    const indexed = await this.#listActiveDirectChildrenBatch(collection.name, [
      ...lookupKeys,
    ]);
    if (this.#disposed) {
      return [];
    }

    // The SUBTREE answer, for the same flush and in the same one round trip.
    // Hints are the only keys asked for here: a hint is the candidate DELETED
    // DIRECTORY, and what makes it one is that indexed documents live beneath
    // it - at ANY depth. Discriminating on direct children alone left a
    // directory whose documents all sit one level deeper looking exactly like a
    // dead temp name. The collection root is never a hint, so no key here can
    // degenerate into "every active document in the collection".
    const hintKeys = new Set<string>();
    for (const [, entry] of live) {
      for (const hint of entry.hints) {
        if (hint !== "" && this.#isReconcilableDirectory(hint, collection)) {
          hintKeys.add(hint);
        }
      }
    }
    const descendants = await this.#listActiveDescendantsBatch(
      collection.name,
      [...hintKeys]
    );
    if (this.#disposed) {
      return [];
    }

    /**
     * The indexed answer for one directory, in the same shape the unbatched
     * seam returned. A failed lookup is propagated per directory rather than
     * summarized once: reconciliation reports store failures against the
     * directory they blocked, and infers no deactivation from them.
     */
    const indexedFor = (directory: string): StoreResult<string[]> =>
      indexed.ok
        ? { ok: true, value: indexed.value.get(directory) ?? [] }
        : { ok: false, error: indexed.error };

    /**
     * The subtree answer for one directory: from the batch when it was a hint,
     * fetched on demand otherwise (a dirty directory that turns out to be gone
     * is rare enough not to be worth widening every flush's batch for).
     * `null` means the store predates the seam - the caller then degrades to
     * the direct-child answer rather than inferring anything.
     */
    const descendantCache = new Map<string, StoreResult<string[]> | null>();
    if (descendants !== null) {
      for (const hint of hintKeys) {
        descendantCache.set(
          hint,
          descendants.ok
            ? { ok: true, value: descendants.value.get(hint) ?? [] }
            : { ok: false, error: descendants.error }
        );
      }
    }
    const descendantsFor = async (
      directory: string
    ): Promise<StoreResult<string[]> | null> => {
      if (descendantCache.has(directory)) {
        return descendantCache.get(directory) ?? null;
      }
      const fetched = await this.#listActiveDescendants(
        collection.name,
        directory
      );
      descendantCache.set(directory, fetched);
      return fetched;
    };

    /**
     * Directories whose REMOVAL was already established when the event was
     * classified (`#widenVanishedExactPaths`). Kept as intent so a directory
     * recreated between that classification and this enumeration cannot narrow
     * a subtree removal back to direct children.
     */
    const subtreeIntent = new Set<string>();
    for (const [directory, entry] of live) {
      if (entry.subtree) {
        subtreeIntent.add(directory);
      }
    }

    const reconcile = async (
      directory: string
    ): Promise<DirectoryReconciliation> => {
      const cached = resolved.get(directory);
      if (cached) {
        return cached;
      }
      const outcome = this.#isReconcilableDirectory(directory, collection)
        ? await this.#reconcileDirectory(
            collection,
            walkConfig,
            directory,
            indexedFor(directory),
            descendantsFor,
            subtreeIntent.has(directory)
          )
        : {
            directory,
            candidates: [],
            enumerationFailed: false,
            // Never started, so it owes no terminal outcome.
            started: false,
            failureReported: false,
          };
      resolved.set(directory, outcome);
      return outcome;
    };

    for (const [directory, entry] of live) {
      if (this.#disposed) {
        break;
      }
      // No hint at all means the affected directory itself is the only area we
      // can honestly claim changed.
      let needsDirectory = entry.hints.size === 0;
      for (const hint of entry.hints) {
        if (this.#disposed) {
          break;
        }
        // Subtree-aware where the store supports it, direct children where it
        // does not. Either way an unanswered store query is never read as
        // "nothing is there".
        const hintIndexed = (await descendantsFor(hint)) ?? indexedFor(hint);
        if (!hintIndexed.ok) {
          // The discriminator itself failed. This is NOT "nothing is indexed
          // here": collapsing the two would let a store outage silently turn a
          // deleted subtree into a parent-directory reconciliation, with the
          // descendants left active and no diagnostic at all (R7/R9). Report it
          // against the hint it blocked and infer nothing from it - the hint is
          // never reconciled, so nothing under it can deactivate. The affected
          // directory is still reconciled from DISK, which is what catches an
          // atomic-save sibling in the same window.
          this.#notifyDiagnostic(() =>
            this.#callbacks?.onReconcileFailed?.({
              collection: collection.name,
              directory: hint,
              stage: "store",
              cause: hintIndexed.error,
            })
          );
          needsDirectory = true;
          continue;
        }
        if (hintIndexed.value.length === 0) {
          // Nothing active is indexed under this hint: it is not a deleted
          // indexed directory, so the event means a file changed in the
          // affected directory.
          needsDirectory = true;
          continue;
        }
        const hintOutcome = await reconcile(hint);
        if (
          hintOutcome.candidates.length === 0 &&
          !hintOutcome.enumerationFailed
        ) {
          // An unreadable hint directory is NOT retried through its parent: it
          // failed closed on purpose.
          needsDirectory = true;
        }
      }
      if (needsDirectory && !this.#disposed) {
        await reconcile(directory);
      }
    }

    // Every STARTED reconciliation is returned, including the ones that
    // resolved to nothing: the caller owes each of them a terminal outcome, and
    // filtering empty outcomes away here is what previously made a successful
    // zero-candidate reconciliation disappear between start and completion.
    return [...resolved.values()].filter((outcome) => outcome.started);
  }

  /**
   * Union the eligible disk children and the active indexed children.
   *
   * `indexed` is the pre-resolved answer from the flush's single batched store
   * lookup, passed in rather than fetched here so one directory is never
   * queried twice within a flush.
   */
  async #reconcileDirectory(
    collection: Collection,
    walkConfig: WalkConfig,
    directory: string,
    indexed: StoreResult<string[]>,
    descendantsFor: (
      directory: string
    ) => Promise<StoreResult<string[]> | null>,
    subtreeIntent: boolean
  ): Promise<DirectoryReconciliation> {
    this.#notifyDiagnostic(() =>
      this.#callbacks?.onReconcileStart?.({
        collection: collection.name,
        directory,
      })
    );

    const disk = await listEligibleDirectChildren(directory, walkConfig);
    if (disk.status === "error") {
      // Fail closed: an unreadable directory must never be read as an
      // authoritative empty directory, or live documents would deactivate.
      this.#notifyDiagnostic(() =>
        this.#callbacks?.onReconcileFailed?.({
          collection: collection.name,
          directory,
          stage: "enumerate",
          cause: disk.cause,
        })
      );
      return {
        directory,
        candidates: [],
        enumerationFailed: true,
        started: true,
        failureReported: true,
      };
    }

    const candidates = new Set<string>(
      disk.status === "present" ? disk.relPaths : []
    );

    // A directory that is GONE takes its WHOLE removed subtree, not just its
    // direct children. The reported path can sit at any depth, so a deleted
    // `dir1/` whose documents live in `dir1/sub/` would otherwise leave every
    // one of them active - the "direct children only" limitation this change
    // removes. A directory that is still PRESENT stays deliberately narrow: it
    // is usually a temp-file event, and its nested documents did not change.
    //
    // `subtreeIntent` is the SECOND way in, and it is not redundant with the
    // enumeration: the removal may have been established one classification
    // earlier, and the directory recreated since. Re-deriving the answer from
    // this enumeration alone would then narrow it back to direct children and
    // strand the nested documents that really did go. The recreated files are
    // safe either way - `syncPaths` stats every candidate.
    const removed = disk.status === "missing" || subtreeIntent;
    let indexedSide = indexed;
    if (removed) {
      // The collection ROOT is the one directory with no bounded subtree. When
      // it is genuinely absent every active document in the collection is
      // implicated, and the descendant seam cannot express that (`""` has no
      // prefix range), so the whole-collection seam answers instead. A root
      // that merely could not be READ never reaches here: that is an
      // `enumerate` failure above, and it fails closed.
      indexedSide =
        (directory === ""
          ? await this.#listActiveCollectionPaths(collection.name)
          : await descendantsFor(directory)) ?? indexed;
    }

    // The indexed side is what makes deletion work: a vanished file leaves
    // nothing on disk to enumerate, so its relPath can only come from the
    // store, and `syncPaths` marks it inactive through its own ENOENT branch.
    if (indexedSide.ok) {
      for (const relPath of indexedSide.value) {
        candidates.add(relPath);
      }
    } else {
      this.#notifyDiagnostic(() =>
        this.#callbacks?.onReconcileFailed?.({
          collection: collection.name,
          directory,
          stage: "store",
          cause: indexedSide.error,
        })
      );
    }

    const root = normalize(collection.path);
    return {
      directory,
      // Suppression applies to the RESOLVED candidate paths, not to the
      // directory: an application-originated write inside a reconciled
      // directory must stay suppressed.
      candidates: [...candidates].filter((relPath) => {
        const suppressedUntil = this.#suppressedPaths.get(
          normalize(join(root, relPath))
        );
        return !(suppressedUntil && suppressedUntil > Date.now());
      }),
      enumerationFailed: false,
      started: true,
      // A store failure is already a reported terminal outcome for this
      // directory: the disk half may still yield candidates, but the
      // reconciliation was partial and must not also be claimed as complete.
      failureReported: !indexedSide.ok,
    };
  }

  /**
   * Active indexed source paths beneath SEVERAL directories in one round trip.
   *
   * This is the flush's hint DISCRIMINATOR: for each vanished reported name it
   * answers "is anything indexed under here?", which is the only way to tell a
   * recursively deleted directory from a dead temporary filename. Batched so
   * that unique-temp-name churn costs one query per window rather than one per
   * filename.
   *
   * Never throws. `null` means the store predates the seam, and each hint falls
   * back to the direct-child answer.
   */
  async #listActiveDescendantsBatch(
    collectionName: string,
    directories: string[]
  ): Promise<StoreResult<Map<string, string[]>> | null> {
    if (directories.length === 0) {
      return { ok: true, value: new Map() };
    }
    const store = this.#store as Partial<SqliteAdapter> | null;
    if (typeof store?.listActiveDescendantSourcePathsBatch !== "function") {
      return null;
    }
    try {
      return await store.listActiveDescendantSourcePathsBatch(
        collectionName,
        directories
      );
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "QUERY_FAILED",
          message:
            cause instanceof Error
              ? cause.message
              : "active descendant query failed",
          cause,
        },
      };
    }
  }

  /**
   * Every active indexed source path in the collection.
   *
   * Reached only when the collection ROOT was observed ABSENT from disk, which
   * is a whole-collection event by definition: the bounded seams cannot answer
   * it (the descendant lookup rejects `""` because a root prefix range has no
   * bound, and the direct-children lookup returns only the root's own files,
   * stranding every nested document). A root that is present, or merely
   * unreadable, never gets here.
   *
   * Never throws. `null` means the store predates the seam, and the caller
   * degrades to the direct-child answer it already holds - narrower than ideal,
   * never wrong.
   */
  async #listActiveCollectionPaths(
    collectionName: string
  ): Promise<StoreResult<string[]> | null> {
    const store = this.#store as Partial<SqliteAdapter> | null;
    if (typeof store?.listActiveSourcePaths !== "function") {
      return null;
    }
    try {
      return await store.listActiveSourcePaths(collectionName);
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "QUERY_FAILED",
          message:
            cause instanceof Error
              ? cause.message
              : "active collection paths query failed",
          cause,
        },
      };
    }
  }

  /**
   * Active indexed source paths anywhere beneath ONE directory.
   *
   * The on-demand companion to the batched form: used for a dirty directory
   * that turns out to be gone, which is rare enough not to be worth widening
   * every flush's batch for.
   *
   * Never throws. `null` means the store predates the seam, and the caller
   * degrades to the direct-child answer it already holds - narrower than ideal,
   * never wrong. A store FAILURE is a `StoreResult` error, so nothing is
   * deactivated on the strength of an unanswered query.
   */
  async #listActiveDescendants(
    collectionName: string,
    directory: string
  ): Promise<StoreResult<string[]> | null> {
    const store = this.#store as Partial<SqliteAdapter> | null;
    if (typeof store?.listActiveDescendantSourcePaths !== "function") {
      return null;
    }
    try {
      return await store.listActiveDescendantSourcePaths(
        collectionName,
        directory
      );
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "QUERY_FAILED",
          message:
            cause instanceof Error
              ? cause.message
              : "active descendant query failed",
          cause,
        },
      };
    }
  }

  /**
   * Resolve the active indexed direct children of many directories at once.
   *
   * Never throws: a store failure is reported, never inferred from.
   *
   * Prefers the batched seam so a whole flush costs ONE round trip. The
   * per-directory seam remains a supported fallback for a store that predates
   * the batched one; it is a correctness-preserving degradation, not a second
   * strategy, and it restores the per-hint query cost the batch exists to
   * remove. A store exposing neither seam fails closed.
   */
  async #listActiveDirectChildrenBatch(
    collectionName: string,
    directories: string[]
  ): Promise<StoreResult<Map<string, string[]>>> {
    if (directories.length === 0) {
      return { ok: true, value: new Map() };
    }
    const store = this.#store as Partial<SqliteAdapter> | null;
    try {
      if (typeof store?.listActiveDirectChildSourcePathsBatch === "function") {
        return await store.listActiveDirectChildSourcePathsBatch(
          collectionName,
          directories
        );
      }
      if (typeof store?.listActiveDirectChildSourcePaths === "function") {
        const byDirectory = new Map<string, string[]>();
        for (const directory of directories) {
          const result = await store.listActiveDirectChildSourcePaths(
            collectionName,
            directory
          );
          if (!result.ok) {
            return result;
          }
          byDirectory.set(directory, result.value);
        }
        return { ok: true, value: byDirectory };
      }
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "QUERY_FAILED",
          message:
            cause instanceof Error
              ? cause.message
              : "active direct children query failed",
          cause,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "store does not expose listActiveDirectChildSourcePaths",
      },
    };
  }

  #notifySettledIfIdle(): void {
    if (
      this.#syncing.size === 0 &&
      ![...this.#pendingByCollection.values()].some(
        (relPaths) => relPaths.size > 0
      ) &&
      ![...this.#dirtyByCollection.values()].some(
        (directories) => directories.size > 0
      )
    ) {
      this.#callbacks?.onSettled?.();
    }
  }

  #afterSync(collection: Collection, relPaths: string[]): void {
    if (this.#disposed || relPaths.length === 0) {
      return;
    }

    this.#lastSyncAt = new Date().toISOString();
    this.#scheduler?.notifySyncComplete(relPaths);

    if (!this.#eventBus) {
      return;
    }

    for (const relPath of relPaths) {
      const event: DocumentEvent = {
        type: "document-changed",
        uri: `gno://${collection.name}/${relPath.split(sep).join("/")}`,
        collection: collection.name,
        relPath,
        origin: "watcher",
        changedAt: new Date().toISOString(),
      };
      this.#eventBus.emit(event);
    }
  }
}
