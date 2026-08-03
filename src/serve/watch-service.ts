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

/**
 * Why a filesystem event could not name an eligible path directly.
 *
 * `hint-budget-exhausted` is not an event of its own: it is emitted once per
 * affected directory per debounce window when the bounded directory-hint budget
 * fills, so the resulting degradation is visible instead of silent.
 */
export type AmbiguousWatchEventReason =
  | "ineligible-path"
  | "missing-filename"
  | "hint-budget-exhausted";

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
 * How many reported-path directory hints one affected directory may accumulate
 * inside a single debounce window.
 *
 * A hint costs one directory enumeration plus one store query, so an unbounded
 * hint set turns ordinary temp-file churn with unique names (`note.md.tmp.0`,
 * `note.md.tmp.1`, ...) into unbounded sequential filesystem and database work
 * - the "reconciliation amplification" risk. The affected DIRECTORY is always
 * reconciled when the budget fills, which is a superset of every dropped hint
 * that was really a file. The residual, deliberately bounded, degradation is
 * the same class as the documented R12 direct-children boundary: beyond the
 * budget, a deleted SUBDIRECTORY's indexed children wait for `gno update`.
 */
const MAX_DIRECTORY_HINTS = 8;

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
 * Only the root is stamped at queue time. Resolution is ALWAYS performed
 * against the current collection configuration, so a generation stamp would
 * change nothing about filters, patterns, or sync options; a changed ROOT is
 * the one drift that makes the queued area meaningless rather than stale.
 */
interface DirtyDirectoryEntry {
  /** `normalize(collection.path)` when the first event for this key arrived. */
  root: string;
  /** Reported paths under this directory, capped at `MAX_DIRECTORY_HINTS`. */
  hints: Set<string>;
  /** The budget filled and further hints were dropped for this window. */
  hintsTruncated: boolean;
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
   * Keying by directory is what bounds the work. 25 events naming 25 distinct
   * temp files in one directory previously queued 25 independent units; they
   * now collapse to one directory plus at most `MAX_DIRECTORY_HINTS` hints.
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
      entry = { root: watchedRoot, hints: new Set(), hintsTruncated: false };
      dirty.set(directory, entry);
    }
    // A hint only earns budget if it could be reconciled at all; an excluded or
    // dot-prefixed reported path is covered by the directory fallback alone.
    if (reportedIsReconcilable && !entry.hints.has(reported)) {
      if (entry.hints.size < MAX_DIRECTORY_HINTS) {
        entry.hints.add(reported);
      } else if (!entry.hintsTruncated) {
        entry.hintsTruncated = true;
        this.#notifyAmbiguous(
          collection.name,
          directory,
          "hint-budget-exhausted"
        );
      }
    }
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

    const exactPaths = pending ? [...pending] : [];
    const dirtyEntries = dirty ? [...dirty.entries()] : [];
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

    try {
      if (dirtyEntries.length > 0) {
        reconciliations = await this.#reconcileDirtyDirectories(
          collection,
          dirtyEntries
        );
        if (this.#disposed) {
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
      for (const entry of reconciliations) {
        this.#notifyDiagnostic(() =>
          this.#callbacks?.onReconcileComplete?.({
            collection: collection.name,
            directory: entry.directory,
            candidateCount: entry.candidates.length,
            syncedCount: entry.candidates.filter((relPath) =>
              batched.has(relPath)
            ).length,
          })
        );
      }

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
      for (const entry of reconciliations) {
        if (entry.candidates.length > 0) {
          this.#notifyDiagnostic(() =>
            this.#callbacks?.onReconcileFailed?.({
              collection: collection.name,
              directory: entry.directory,
              stage: "sync",
              cause: error,
            })
          );
        }
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
   * Resolve queued dirty directories into concrete candidate relative paths.
   *
   * Resolution order is unchanged by the directory keying: each retained hint
   * (a reported path) resolves first, and the affected directory is the
   * fallback. A hint that resolves to real work (a directory that exists on
   * disk, or one with active indexed children) IS the affected area, so the
   * directory is not enumerated for it - that keeps a recursive directory
   * delete from dragging every unchanged sibling of the deleted directory into
   * the batch. Only when a hint yields nothing is the event read as "a file
   * changed here", and the affected directory is reconciled instead. A key
   * whose hint budget filled always reconciles the directory, because the
   * dropped hints were overwhelmingly ordinary file churn.
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

    const reconcile = async (
      directory: string
    ): Promise<DirectoryReconciliation> => {
      const cached = resolved.get(directory);
      if (cached) {
        return cached;
      }
      const outcome = this.#isReconcilableDirectory(directory, collection)
        ? await this.#reconcileDirectory(collection, walkConfig, directory)
        : { directory, candidates: [], enumerationFailed: false };
      resolved.set(directory, outcome);
      return outcome;
    };

    for (const [directory, entry] of entries) {
      if (this.#disposed) {
        break;
      }
      if (entry.root !== currentRoot) {
        // The collection moved after this event was queued; the queued area no
        // longer exists in the current configuration.
        continue;
      }
      // No hint, or a filled hint budget, means the affected directory itself
      // is the only area we can honestly claim changed.
      let needsDirectory = entry.hints.size === 0 || entry.hintsTruncated;
      for (const hint of entry.hints) {
        if (this.#disposed) {
          break;
        }
        const hintOutcome = await reconcile(hint);
        if (
          hintOutcome.candidates.length === 0 &&
          !hintOutcome.enumerationFailed
        ) {
          // An unreadable hint directory is NOT retried through its parent: it
          // failed closed on purpose. A failed STORE query still falls back,
          // because no deactivation is ever inferred from the disk side alone.
          needsDirectory = true;
        }
      }
      if (needsDirectory && !this.#disposed) {
        await reconcile(directory);
      }
    }

    return [...resolved.values()].filter(
      (outcome) => outcome.candidates.length > 0
    );
  }

  /** Union the eligible disk children and the active indexed children. */
  async #reconcileDirectory(
    collection: Collection,
    walkConfig: WalkConfig,
    directory: string
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
      return { directory, candidates: [], enumerationFailed: true };
    }

    const candidates = new Set<string>(
      disk.status === "present" ? disk.relPaths : []
    );

    // The indexed side is what makes deletion work: a vanished file leaves
    // nothing on disk to enumerate, so its relPath can only come from the
    // store, and `syncPaths` marks it inactive through its own ENOENT branch.
    const indexed = await this.#listActiveDirectChildren(
      collection.name,
      directory
    );
    if (indexed.ok) {
      for (const relPath of indexed.value) {
        candidates.add(relPath);
      }
    } else {
      this.#notifyDiagnostic(() =>
        this.#callbacks?.onReconcileFailed?.({
          collection: collection.name,
          directory,
          stage: "store",
          cause: indexed.error,
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
    };
  }

  /** Never throws: a store failure is reported, never inferred from. */
  async #listActiveDirectChildren(
    collectionName: string,
    directory: string
  ): Promise<StoreResult<string[]>> {
    const store = this.#store as Partial<SqliteAdapter> | null;
    if (typeof store?.listActiveDirectChildSourcePaths !== "function") {
      return {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "store does not expose listActiveDirectChildSourcePaths",
        },
      };
    }
    try {
      return await store.listActiveDirectChildSourcePaths(
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
              : "active direct children query failed",
          cause,
        },
      };
    }
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
