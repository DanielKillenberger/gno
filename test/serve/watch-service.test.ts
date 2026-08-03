import type { WatchListener } from "node:fs";

import { afterEach, describe, expect, mock, test } from "bun:test";
// node:fs/promises is used for mkdtemp/mkdir/rm: Bun has no native equivalents
// for temp-directory creation or filesystem structure operations.
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Collection } from "../../src/config/types";
import type { CollectionSyncResult } from "../../src/ingestion";

import { defaultSyncService } from "../../src/ingestion";
import { CollectionWatchService } from "../../src/serve/watch-service";

function createCollection(name: string, path: string): Collection {
  return {
    name,
    path,
    pattern: "**/*.md",
    include: [],
    exclude: [],
  };
}

function createSyncResult(
  overrides: Partial<CollectionSyncResult> = {}
): CollectionSyncResult {
  return {
    collection: "notes",
    filesProcessed: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesUnchanged: 0,
    filesErrored: 0,
    filesSkipped: 0,
    filesMarkedInactive: 0,
    durationMs: 1,
    errors: [],
    ...overrides,
  };
}

const originalSyncPaths = defaultSyncService.syncPaths.bind(defaultSyncService);
const originalSyncCollection =
  defaultSyncService.syncCollection.bind(defaultSyncService);

afterEach(() => {
  defaultSyncService.syncPaths = originalSyncPaths;
  defaultSyncService.syncCollection = originalSyncCollection;
});

describe("CollectionWatchService", () => {
  test("updateCollections adds new watchers and removes stale ones", () => {
    const closed: string[] = [];
    const watchCalls: string[] = [];

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit: () => undefined } as never,
      scheduler: null,
      store: {} as never,
      watchFactory: ((path: string) => {
        watchCalls.push(path);
        return {
          close: () => {
            closed.push(path);
          },
        };
      }) as never,
    });

    service.start();
    expect(service.getState().activeCollections).toEqual(["notes"]);

    service.updateCollections([
      createCollection("work", "/tmp/work"),
      createCollection("notes", "/tmp/notes"),
    ]);

    expect(service.getState().activeCollections.sort()).toEqual([
      "notes",
      "work",
    ]);
    expect(watchCalls).toEqual(["/tmp/notes", "/tmp/work"]);

    service.updateCollections([createCollection("work", "/tmp/work")]);
    expect(service.getState().activeCollections).toEqual(["work"]);
    expect(closed).toEqual(["/tmp/notes"]);
  });

  test("failed watcher starts are surfaced in state", () => {
    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit: () => undefined } as never,
      scheduler: null,
      store: {} as never,
      watchFactory: (() => {
        throw new Error("recursive watch unavailable");
      }) as never,
    });

    service.start();

    expect(service.getState().failedCollections).toEqual([
      { collection: "notes", reason: "recursive watch unavailable" },
    ]);
  });

  test("ignores paths excluded by collection rules before sync or broadcast", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const emit = mock((_event: unknown) => undefined);
    const notifySyncComplete = mock(() => undefined);
    const onSyncStart = mock(() => undefined);
    const syncPaths = mock(async () => createSyncResult());
    defaultSyncService.syncPaths =
      syncPaths as typeof defaultSyncService.syncPaths;

    const collection = createCollection("notes", "/tmp/notes");
    collection.exclude = [".obsidian"];
    const service = new CollectionWatchService({
      collections: [collection],
      eventBus: { emit } as never,
      scheduler: { notifySyncComplete } as never,
      store: {} as never,
      callbacks: { onSyncStart },
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", ".obsidian/.sync.lock");
    watcherCallback?.("change", "cover.png");
    await Bun.sleep(350);

    expect(syncPaths).not.toHaveBeenCalled();
    expect(onSyncStart).not.toHaveBeenCalled();
    expect(notifySyncComplete).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(service.getState().lastEventAt).toBeNull();
    expect(service.getState().lastSyncAt).toBeNull();
    await service.dispose();
  });

  test("rechecks live collection rules when queued paths flush", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const seenPaths: string[][] = [];
    const onSettled = mock(() => undefined);

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      seenPaths.push(relPaths);
      return createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: relPaths.length,
      });
    }) as typeof defaultSyncService.syncPaths;
    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: null,
      scheduler: null,
      store: {} as never,
      callbacks: { onSettled },
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", "drafts/private.md");
    const updatedCollection = createCollection("notes", "/tmp/notes");
    updatedCollection.exclude = ["drafts"];
    service.updateCollections([updatedCollection]);
    await Bun.sleep(350);

    expect(seenPaths).toEqual([]);
    expect(onSettled).toHaveBeenCalledTimes(1);

    watcherCallback?.("change", "published.md");
    await Bun.sleep(350);
    expect(seenPaths).toEqual([["published.md"]]);
    await service.dispose();
  });

  test("suppresses completion side effects when live rules exclude an in-flight path", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const emit = mock((_event: unknown) => undefined);
    const notifySyncComplete = mock(() => undefined);
    const syncCollection = mock(async () =>
      createSyncResult({ filesMarkedInactive: 1 })
    );
    let finishSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolve) => {
      finishSync = resolve;
    });

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      await syncGate;
      return createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: relPaths.length,
      });
    }) as typeof defaultSyncService.syncPaths;
    defaultSyncService.syncCollection =
      syncCollection as typeof defaultSyncService.syncCollection;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit } as never,
      scheduler: { notifySyncComplete } as never,
      store: {} as never,
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", "private/note.md");
    await Bun.sleep(350);

    const updatedCollection = createCollection("notes", "/tmp/notes");
    updatedCollection.exclude = ["private"];
    service.updateCollections([updatedCollection]);
    finishSync?.();
    await Bun.sleep(20);

    expect(syncCollection).toHaveBeenCalledTimes(1);
    expect(notifySyncComplete).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    await service.dispose();
  });

  test("does not reconcile an in-flight sync for an equivalent config refresh", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const emit = mock((_event: unknown) => undefined);
    const syncCollection = mock(async () => createSyncResult());
    let finishSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolve) => {
      finishSync = resolve;
    });

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      await syncGate;
      return createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: relPaths.length,
      });
    }) as typeof defaultSyncService.syncPaths;
    defaultSyncService.syncCollection =
      syncCollection as typeof defaultSyncService.syncCollection;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit } as never,
      scheduler: null,
      store: {} as never,
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", "note.md");
    await Bun.sleep(350);

    service.updateCollections([createCollection("notes", "/tmp/notes")]);
    finishSync?.();
    await Bun.sleep(20);

    expect(syncCollection).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  test("does not reconcile or emit after disposal during an in-flight sync", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const emit = mock((_event: unknown) => undefined);
    const notifySyncComplete = mock(() => undefined);
    const onSyncComplete = mock(() => undefined);
    const syncCollection = mock(async () => createSyncResult());
    let finishSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolve) => {
      finishSync = resolve;
    });

    defaultSyncService.syncPaths = (async () => {
      await syncGate;
      return createSyncResult({ filesUpdated: 1 });
    }) as typeof defaultSyncService.syncPaths;
    defaultSyncService.syncCollection =
      syncCollection as typeof defaultSyncService.syncCollection;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit } as never,
      scheduler: { notifySyncComplete } as never,
      store: {} as never,
      callbacks: { onSyncComplete },
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", "note.md");
    await Bun.sleep(350);

    const disposal = service.dispose();
    finishSync?.();
    await disposal;

    expect(syncCollection).not.toHaveBeenCalled();
    expect(onSyncComplete).not.toHaveBeenCalled();
    expect(notifySyncComplete).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  test("restarts a watcher when a collection root changes", async () => {
    const watchedPaths: string[] = [];
    const closedPaths: string[] = [];
    const callbacks = new Map<
      string,
      (eventType: string, filename: string) => void
    >();
    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/old-notes")],
      eventBus: null,
      scheduler: null,
      store: {} as never,
      watchFactory: ((
        path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watchedPaths.push(path);
        callbacks.set(
          path,
          callback as (eventType: string, filename: string) => void
        );
        return {
          close: () => {
            closedPaths.push(path);
          },
        };
      }) as never,
    });

    service.start();
    service.updateCollections([
      createCollection("notes", "/tmp/replacement-notes"),
    ]);

    expect(watchedPaths).toEqual(["/tmp/old-notes", "/tmp/replacement-notes"]);
    expect(closedPaths).toEqual(["/tmp/old-notes"]);
    expect(service.getState().activeCollections).toEqual(["notes"]);
    expect(callbacks.size).toBe(2);
    await service.dispose();
  });

  test("serializes remove and re-add behind an in-flight sync without an ABA collision", async () => {
    const callbacks = new Map<
      string,
      (eventType: string, filename: string) => void
    >();
    const seenPaths: string[][] = [];
    const emit = mock((_event: unknown) => undefined);
    const notifySyncComplete = mock(() => undefined);
    const syncCollection = mock(async () =>
      createSyncResult({
        filesProcessed: 1,
        filesAdded: 1,
        files: [{ relPath: "new.md", status: "added" }],
      })
    );
    let finishFirstSync: (() => void) | undefined;
    const firstSync = new Promise<void>((resolve) => {
      finishFirstSync = resolve;
    });

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      seenPaths.push(relPaths);
      if (seenPaths.length === 1) {
        await firstSync;
      }
      const status = seenPaths.length === 1 ? "updated" : "unchanged";
      return createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: status === "updated" ? relPaths.length : 0,
        filesUnchanged: status === "unchanged" ? relPaths.length : 0,
        files: relPaths.map((relPath) => ({ relPath, status })),
      });
    }) as typeof defaultSyncService.syncPaths;
    defaultSyncService.syncCollection =
      syncCollection as typeof defaultSyncService.syncCollection;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/old-notes")],
      eventBus: { emit } as never,
      scheduler: { notifySyncComplete } as never,
      store: {} as never,
      watchFactory: ((
        path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        callbacks.set(
          path,
          callback as (eventType: string, filename: string) => void
        );
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    callbacks.get("/tmp/old-notes")?.("change", "old.md");
    await Bun.sleep(350);
    expect(seenPaths).toEqual([["old.md"]]);

    service.updateCollections([]);
    service.updateCollections([
      createCollection("notes", "/tmp/replacement-notes"),
    ]);
    callbacks.get("/tmp/replacement-notes")?.("change", "new.md");
    await Bun.sleep(350);
    expect(seenPaths).toEqual([["old.md"]]);

    finishFirstSync?.();
    await Bun.sleep(20);
    expect(syncCollection).toHaveBeenCalledTimes(1);
    expect(seenPaths).toEqual([["old.md"], ["new.md"]]);
    expect(notifySyncComplete).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      collection: "notes",
      relPath: "new.md",
      uri: "gno://notes/new.md",
    });
    await service.dispose();
  });

  test("reprocesses an edit queued after full reconciliation scanned its path", async () => {
    const callbacks = new Map<
      string,
      (eventType: string, filename: string) => void
    >();
    const seenPaths: string[][] = [];
    let finishFirstSync: (() => void) | undefined;
    let finishFullSync: (() => void) | undefined;
    let markFullSyncStarted: (() => void) | undefined;
    const firstSync = new Promise<void>((resolve) => {
      finishFirstSync = resolve;
    });
    const fullSyncGate = new Promise<void>((resolve) => {
      finishFullSync = resolve;
    });
    const fullSyncStarted = new Promise<void>((resolve) => {
      markFullSyncStarted = resolve;
    });

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      seenPaths.push(relPaths);
      if (seenPaths.length === 1) {
        await firstSync;
      }
      return createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: relPaths.length,
        files: relPaths.map((relPath) => ({
          relPath,
          status: "updated",
        })),
      });
    }) as typeof defaultSyncService.syncPaths;
    defaultSyncService.syncCollection = (async () => {
      markFullSyncStarted?.();
      await fullSyncGate;
      return createSyncResult({
        filesProcessed: 1,
        filesAdded: 1,
        files: [{ relPath: "new.md", status: "added" }],
      });
    }) as typeof defaultSyncService.syncCollection;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/old-notes")],
      eventBus: null,
      scheduler: null,
      store: {} as never,
      watchFactory: ((
        path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        callbacks.set(
          path,
          callback as (eventType: string, filename: string) => void
        );
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    callbacks.get("/tmp/old-notes")?.("change", "old.md");
    await Bun.sleep(350);
    service.updateCollections([
      createCollection("notes", "/tmp/replacement-notes"),
    ]);

    finishFirstSync?.();
    await fullSyncStarted;
    callbacks.get("/tmp/replacement-notes")?.("change", "new.md");
    await Bun.sleep(350);
    finishFullSync?.();
    await Bun.sleep(20);

    expect(seenPaths).toEqual([["old.md"], ["new.md"]]);
    await service.dispose();
  });

  test("forwards eligible deletion paths for inactive sync and one notification", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const seenPaths: string[][] = [];
    const emit = mock((_event: unknown) => undefined);
    const notifySyncComplete = mock(() => undefined);

    defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
      seenPaths.push(relPaths);
      return createSyncResult({
        filesProcessed: 1,
        filesUpdated: 1,
        filesMarkedInactive: 1,
      });
    }) as typeof defaultSyncService.syncPaths;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: { emit } as never,
      scheduler: { notifySyncComplete } as never,
      store: {} as never,
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return { close: () => undefined };
      }) as never,
    });

    service.start();
    watcherCallback?.("rename", "deleted.md");
    await Bun.sleep(350);

    expect(seenPaths).toEqual([["deleted.md"]]);
    expect(notifySyncComplete).toHaveBeenCalledTimes(1);
    expect(notifySyncComplete).toHaveBeenCalledWith(["deleted.md"]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      relPath: "deleted.md",
      uri: "gno://notes/deleted.md",
    });
    await service.dispose();
  });

  test("supports headless mode without event bus and emits sync callbacks", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const onSyncStart = mock(() => undefined);
    const onSyncComplete = mock(() => undefined);

    defaultSyncService.syncPaths = (async () => ({
      collection: "notes",
      filesProcessed: 1,
      filesAdded: 1,
      filesUpdated: 0,
      filesUnchanged: 0,
      filesErrored: 0,
      filesSkipped: 0,
      filesMarkedInactive: 0,
      durationMs: 3,
      errors: [],
    })) as typeof defaultSyncService.syncPaths;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: null,
      scheduler: null,
      store: {} as never,
      callbacks: {
        onSyncStart,
        onSyncComplete,
      },
      watchFactory: ((
        path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return {
          close: () => {
            void path;
          },
        };
      }) as never,
    });

    service.start();
    watcherCallback?.("change", "doc.md");
    await Bun.sleep(350);

    expect(onSyncStart).toHaveBeenCalledTimes(1);
    expect(onSyncComplete).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  test("updateCollections refreshes sync options for later watcher syncs", async () => {
    let watcherCallback:
      | ((eventType: string, filename: string) => void)
      | undefined;
    const seenFingerprints: Array<string | undefined> = [];
    const seenPaths: string[][] = [];

    defaultSyncService.syncPaths = (async (
      _collection,
      _store,
      relPaths,
      options
    ) => {
      seenPaths.push(relPaths);
      seenFingerprints.push(options?.contentTypeRulesFingerprint);
      return {
        collection: "notes",
        filesProcessed: 1,
        filesAdded: 0,
        filesUpdated: 1,
        filesUnchanged: 0,
        filesErrored: 0,
        filesSkipped: 0,
        filesMarkedInactive: 0,
        durationMs: 3,
        errors: [],
      };
    }) as typeof defaultSyncService.syncPaths;

    const service = new CollectionWatchService({
      collections: [createCollection("notes", "/tmp/notes")],
      eventBus: null,
      scheduler: null,
      store: {} as never,
      syncOptions: { contentTypeRulesFingerprint: "before" },
      watchFactory: ((
        _path: string,
        _options: { recursive: boolean },
        callback: WatchListener<string>
      ) => {
        watcherCallback = callback as typeof watcherCallback;
        return {
          close: () => undefined,
        };
      }) as never,
    });

    service.start();
    service.updateCollections([createCollection("notes", "/tmp/notes")], {
      contentTypeRulesFingerprint: "after",
    });
    watcherCallback?.("change", "doc.md");
    await Bun.sleep(350);

    expect(seenFingerprints).toEqual(["after"]);
    expect(seenPaths).toEqual([["doc.md"]]);
    await service.dispose();
  });
});

/**
 * fn-114 task .1 — RED regression coverage. These tests are EXPECTED TO FAIL
 * until the bounded directory-reconciliation path lands in fn-114 task .3.
 * They must not be weakened to go green.
 *
 * ## Provenance of the replayed sequences
 *
 * Every tuple below is a REAL capture, not an assumed shape. They were
 * recorded by `test/serve/watch-service.fs-smoke.test.ts` on Bun 1.3.11 under
 * linux 6.10.14 (Debian container, `tmpfs`-backed temp dir, so the events are
 * genuine inotify and not a degraded bind mount), cross-checked against the
 * same probe on darwin 25.5.0. Full capture:
 *
 * | scenario                   | linux 6.10.14 / Bun 1.3.11        | darwin 25.5.0 / Bun 1.3.11                                |
 * | -------------------------- | --------------------------------- | --------------------------------------------------------- |
 * | directCreate               | `direct.md`                       | `direct.md`                                                |
 * | atomicCreatePlainTemp      | `note.md.tmp`                     | `note.md.tmp`, `note.md`                                   |
 * | atomicCreateHiddenTemp     | `hidden-atomic.md`                | `.gno-tmp.abc123`, `hidden-atomic.md`                      |
 * | atomicReplaceNested        | `nested/note.md.tmp`              | `nested/note.md.tmp`, `nested/note.md`, `nested/note.md`   |
 * | fileDeletion               | `direct.md`                       | `direct.md`                                                |
 * | recursiveDirectoryDeletion | `dir1`                            | `dir1/b.md`, `dir1/a.md`, `dir1`                           |
 * | newSubdirectoryWrite       | (nothing)                         | `post/d.md`                                                |
 * | caseOnlyRename             | `foo.md`                          | `Foo.md`, `foo.md`                                         |
 *
 * What the capture actually establishes — some of it contradicts what the spec
 * assumed, and the tests follow the data:
 *
 * 1. oven-sh/bun#36328 is NOT fixed in Bun 1.3.11. For an atomic save through a
 *    PLAIN temp name, Linux reports only the SOURCE (`note.md.tmp`) and never
 *    the destination `note.md`. That is the ambiguous event this suite replays.
 * 2. A DOT-PREFIXED temp name behaves the opposite way, and not because the bug
 *    is fixed: Bun's Linux watcher never reports dot-prefixed names at all, so
 *    the source is filtered out and only the destination survives. A fixture
 *    built on `.gno-tmp.<id>` would therefore replay a sequence Linux never
 *    produces, and the current code already handles the one it does produce.
 * 3. A single-file delete DOES name the deleted file on both platforms — which
 *    is exactly why the existing green deletion test passes. The captured
 *    stale-active condition is a RECURSIVE DIRECTORY DELETE: Linux reports only
 *    `dir1`, never `dir1/a.md` or `dir1/b.md`, so both indexed documents stay
 *    active forever.
 * 4. Two further defects were captured and are recorded here for task .3 rather
 *    than asserted by this task: Linux does not extend recursion to
 *    subdirectories created after the watch began (`newSubdirectoryWrite`
 *    reported nothing), and operations landing in one watcher read batch
 *    collapse to a single delivered event (300 rapid writes delivered 20).
 *
 * `matchesWalkPath` rejects `note.md.tmp` and `dir1`, and
 * `src/serve/watch-service.ts:203-212` drops the event, so nothing reaches
 * `syncPaths`.
 *
 * The collection root is a real temp directory here because reconciliation
 * must read the directory's true final state; the watcher itself is still the
 * deterministic fake so no test depends on real event timing.
 */
const AMBIGUOUS_EVENT_WAIT_MS = 2000;
const RED_TEST_TIMEOUT_MS = 15_000;

/**
 * Captured linux/Bun-1.3.11 shape: an atomic save through a plain temp name
 * reports the SOURCE only. Destination `note.md` is never named.
 */
const LINUX_ATOMIC_CREATE_SEQUENCE: ReadonlyArray<
  readonly [string, string | null]
> = [["rename", "note.md.tmp"]];
/** Same shape for a replacement inside a pre-existing nested directory. */
const LINUX_ATOMIC_REPLACE_SEQUENCE: ReadonlyArray<
  readonly [string, string | null]
> = [["rename", "nested/note.md.tmp"]];
/**
 * Captured linux/Bun-1.3.11 shape for `rm -rf dir1`: only the directory is
 * named; the eligible files it held are never reported.
 */
const LINUX_DIRECTORY_DELETION_SEQUENCE: ReadonlyArray<
  readonly [string, string | null]
> = [["rename", "dir1"]];

function createSyncPathsProbe() {
  const batches: string[][] = [];
  let resolveFirst: ((batch: string[]) => void) | null = null;
  const firstBatch = new Promise<string[]>((resolve) => {
    resolveFirst = resolve;
  });

  defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
    const batch = [...relPaths];
    batches.push(batch);
    resolveFirst?.(batch);
    resolveFirst = null;
    return createSyncResult({
      filesProcessed: batch.length,
      filesUpdated: batch.length,
    });
  }) as typeof defaultSyncService.syncPaths;

  return {
    batches,
    /**
     * Resolves as soon as the watcher hands a batch to `syncPaths`. The
     * timeout is a hard failure bound so the RED case fails with a readable
     * assertion instead of hanging; it is not standing in for a settle signal.
     */
    async waitForBatch(): Promise<string[] | "NO_SYNC_WITHIN_TIMEOUT"> {
      const timeout = Bun.sleep(AMBIGUOUS_EVENT_WAIT_MS).then(
        () => "NO_SYNC_WITHIN_TIMEOUT" as const
      );
      return await Promise.race([firstBatch, timeout]);
    },
  };
}

/**
 * Store double exposing only the fn-114 task .2 seam the deletion
 * reconciliation needs: the ACTIVE indexed direct children of a directory.
 * This is how the test represents the indexed side — the half a purely
 * filesystem-shaped fixture cannot express, because a deleted file leaves no
 * trace on disk to enumerate.
 */
function createActiveChildrenStore(activeByDir: Record<string, string[]>): {
  store: unknown;
  calls: Array<{ collection: string; dirRelPath: string }>;
} {
  const calls: Array<{ collection: string; dirRelPath: string }> = [];
  return {
    calls,
    store: {
      listActiveDirectChildSourcePaths(collection: string, dirRelPath: string) {
        calls.push({ collection, dirRelPath });
        return Promise.resolve({
          ok: true as const,
          value: activeByDir[dirRelPath] ?? [],
        });
      },
    },
  };
}

function createFakeWatcherService(collection: Collection, store: unknown = {}) {
  let watcherCallback:
    | ((eventType: string, filename: string | null) => void)
    | undefined;

  const service = new CollectionWatchService({
    collections: [collection],
    eventBus: null,
    scheduler: null,
    store: store as never,
    watchFactory: ((
      _path: string,
      _options: { recursive: boolean },
      callback: WatchListener<string>
    ) => {
      watcherCallback = callback as typeof watcherCallback;
      return { close: () => undefined };
    }) as never,
  });

  return {
    service,
    emit: (sequence: ReadonlyArray<readonly [string, string | null]>): void => {
      for (const [eventType, filename] of sequence) {
        watcherCallback?.(eventType, filename);
      }
    },
  };
}

describe("CollectionWatchService ambiguous-event reconciliation (fn-114 RED)", () => {
  test(
    "syncs the final eligible file when an atomic create reports only the temp name",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-red-create-"));
      // Post-rename disk state: the atomic writer's destination exists, the
      // temp source does not, and an ineligible sibling must stay unindexed.
      await Bun.write(join(root, "note.md"), "# atomic\n");
      await Bun.write(join(root, "cover.png"), "not markdown");

      const probe = createSyncPathsProbe();
      const { service, emit } = createFakeWatcherService(
        createCollection("notes", root)
      );

      try {
        service.start();
        emit(LINUX_ATOMIC_CREATE_SEQUENCE);

        expect(await probe.waitForBatch()).toEqual(["note.md"]);
      } finally {
        await service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "syncs an atomically replaced existing eligible file reported only as a nested temp name",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-red-replace-"));
      await mkdir(join(root, "nested"), { recursive: true });
      // `nested/note.md` was already indexed; the atomic writer replaced its
      // contents, and only the temp source name was reported.
      await Bun.write(join(root, "nested", "note.md"), "# replaced\n");

      const probe = createSyncPathsProbe();
      const { service, emit } = createFakeWatcherService(
        createCollection("notes", root)
      );

      try {
        service.start();
        emit(LINUX_ATOMIC_REPLACE_SEQUENCE);

        expect(await probe.waitForBatch()).toEqual(["nested/note.md"]);
      } finally {
        await service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  /**
   * Deletion coverage — the real stale-active condition, both halves.
   *
   * The existing green case above ("forwards eligible deletion paths for
   * inactive sync and one notification") passes because a SINGLE-FILE delete
   * names the deleted file on every platform we captured: `matchesWalkPath` is
   * filesystem-free (`src/ingestion/walker.ts:182-186`), so a deleted
   * `deleted.md` still passes eligibility and reaches `syncPaths`, which marks
   * it inactive. That case was never the production defect.
   *
   * The captured defect is a RECURSIVE DIRECTORY delete. On linux/Bun 1.3.11,
   * `rm -rf dir1` reports ONLY `dir1` — the eligible `dir1/a.md` and
   * `dir1/b.md` it held are never named. `matchesWalkPath("dir1")` rejects the
   * directory, the event is dropped, and both indexed documents stay ACTIVE
   * forever. That is the live stale-active condition.
   *
   * The indexed half cannot be expressed from disk state, because the deleted
   * files leave nothing on disk to enumerate. It is expressed through fn-114
   * task .2's store seam (`listActiveDirectChildSourcePaths`), which task .3
   * must call so the vanished children reconcile to inactive.
   */
  test(
    "deactivates indexed children when a recursive directory delete reports only the directory",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-red-delete-"));
      // Post-delete disk state: `dir1` and everything under it is gone; the
      // still-present eligible sibling at the root must not be disturbed.
      await Bun.write(join(root, "kept.md"), "# kept\n");

      const probe = createSyncPathsProbe();
      // Indexed side: both children of the vanished directory are still ACTIVE.
      const { store, calls } = createActiveChildrenStore({
        dir1: ["dir1/a.md", "dir1/b.md"],
      });
      const { service, emit } = createFakeWatcherService(
        createCollection("notes", root),
        store
      );

      try {
        service.start();
        emit(LINUX_DIRECTORY_DELETION_SEQUENCE);

        const batch = await probe.waitForBatch();
        expect(batch).not.toBe("NO_SYNC_WITHIN_TIMEOUT");
        // Both stale-active documents must be handed to `syncPaths`, which
        // marks a missing file inactive (`src/ingestion/sync.ts:1218-1267`).
        expect(batch).toContain("dir1/a.md");
        expect(batch).toContain("dir1/b.md");
        // R4: an ineligible event is not permission to index the directory
        // itself, nor to touch unrelated siblings that did not change.
        expect(batch).not.toContain("dir1");
        expect(batch).not.toContain("kept.md");
        // The indexed side must be consulted for the event's own directory.
        expect(calls).toContainEqual({
          collection: "notes",
          dirRelPath: "dir1",
        });
      } finally {
        await service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );
});

/**
 * fn-114 task .3 — acceptance coverage for the bounded reconciliation path.
 *
 * These sit alongside the RED cases above and pin the behavior the RED tests do
 * not: that the exact-path flow is untouched, that repeated events coalesce
 * into ONE reconciliation batch (never asserted through delivered event counts,
 * which Bun collapses per watcher read batch), that the R12 direct-children
 * boundary is a tested limitation rather than a silent gap, and that every
 * degraded path fails closed, stays visible through the new diagnostics, and
 * leaves the watcher armed.
 */

interface ReconcileHarnessOptions {
  store?: unknown;
  eventBus?: { emit: (event: unknown) => void } | null;
  scheduler?: { notifySyncComplete: (relPaths: string[]) => void } | null;
  syncResult?: (relPaths: string[]) => CollectionSyncResult;
  /**
   * Make EVERY fn-114 diagnostic observer throw after recording its event, so
   * a test can assert that a broken consumer cannot change watcher or flush
   * control flow (R7/R9).
   */
  throwFromDiagnostics?: boolean;
}

function createReconcileHarness(
  collection: Collection,
  options: ReconcileHarnessOptions = {}
) {
  const batches: string[][] = [];
  const ambiguous: Array<{
    collection: string;
    directory: string | null;
    reason: string;
  }> = [];
  const started: Array<{ collection: string; directory: string }> = [];
  const completed: Array<{
    collection: string;
    directory: string;
    candidateCount: number;
    syncedCount: number;
  }> = [];
  const failed: Array<{
    collection: string;
    directory: string | null;
    stage: string;
    cause: unknown;
  }> = [];

  defaultSyncService.syncPaths = (async (_collection, _store, relPaths) => {
    batches.push([...relPaths]);
    return (
      options.syncResult?.(relPaths) ??
      createSyncResult({
        filesProcessed: relPaths.length,
        filesUpdated: relPaths.length,
        files: relPaths.map((relPath) => ({ relPath, status: "updated" })),
      })
    );
  }) as typeof defaultSyncService.syncPaths;

  function explodeIfRequested(): void {
    if (options.throwFromDiagnostics) {
      throw new Error("diagnostic observer exploded");
    }
  }

  let notifySettled: (() => void) | null = null;
  let watcherCallback:
    | ((eventType: string, filename: string | null) => void)
    | undefined;

  const service = new CollectionWatchService({
    collections: [collection],
    eventBus: (options.eventBus ?? null) as never,
    scheduler: (options.scheduler ?? null) as never,
    store: (options.store ?? {}) as never,
    callbacks: {
      onSettled: () => {
        const resolve = notifySettled;
        notifySettled = null;
        resolve?.();
      },
      onAmbiguousEvent: (event) => {
        ambiguous.push(event);
        explodeIfRequested();
      },
      onReconcileStart: (event) => {
        started.push(event);
        explodeIfRequested();
      },
      onReconcileComplete: (event) => {
        completed.push(event);
        explodeIfRequested();
      },
      onReconcileFailed: (event) => {
        failed.push(event);
        explodeIfRequested();
      },
    },
    watchFactory: ((
      _path: string,
      _options: { recursive: boolean },
      callback: WatchListener<string>
    ) => {
      watcherCallback = callback as typeof watcherCallback;
      return { close: () => undefined };
    }) as never,
  });

  return {
    service,
    batches,
    ambiguous,
    started,
    completed,
    failed,
    emit(sequence: ReadonlyArray<readonly [string, string | null]>): void {
      for (const [eventType, filename] of sequence) {
        watcherCallback?.(eventType, filename);
      }
    },
    /**
     * Resolves on the watcher's own settle signal, so no assertion below is
     * timed against a fixed sleep. The race only bounds a hang.
     */
    async settle(): Promise<"settled" | "NO_SETTLE_WITHIN_TIMEOUT"> {
      const settled = new Promise<"settled">((resolve) => {
        notifySettled = () => resolve("settled");
      });
      return await Promise.race([
        settled,
        Bun.sleep(AMBIGUOUS_EVENT_WAIT_MS).then(
          () => "NO_SETTLE_WITHIN_TIMEOUT" as const
        ),
      ]);
    },
  };
}

/** Store double recording every active-children lookup it is asked for. */
function createRecordingStore(
  activeByDir: Record<string, string[]>,
  behavior: "ok" | "fail" = "ok"
) {
  const calls: string[] = [];
  return {
    calls,
    store: {
      listActiveDirectChildSourcePaths(
        _collection: string,
        dirRelPath: string
      ) {
        calls.push(dirRelPath);
        return Promise.resolve(
          behavior === "ok"
            ? { ok: true as const, value: activeByDir[dirRelPath] ?? [] }
            : {
                ok: false as const,
                error: { code: "QUERY_FAILED", message: "store offline" },
              }
        );
      },
    },
  };
}

describe("CollectionWatchService bounded reconciliation (fn-114 task .3)", () => {
  test(
    "keeps exact eligible events on the per-path flow with no directory work",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-exact-"));
      await Bun.write(join(root, "doc.md"), "# doc\n");
      await Bun.write(join(root, "neighbour.md"), "# neighbour\n");
      const { store, calls } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["change", "doc.md"]]);
        expect(await harness.settle()).toBe("settled");

        // Only the reported path syncs: no enumeration, no store lookup, and
        // the eligible neighbour on disk is never pulled in.
        expect(harness.batches).toEqual([["doc.md"]]);
        expect(calls).toEqual([]);
        expect(harness.started).toEqual([]);
        expect(harness.ambiguous).toEqual([]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "coalesces repeated ambiguous events for one directory into a single batch",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-coalesce-"));
      await Bun.write(join(root, "note.md"), "# atomic\n");
      const { store, calls } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        // Deliberately asserting RECONCILIATION WORK, not delivered events:
        // Bun collapses whatever lands in one watcher read batch (fn-114 .1
        // measured 300 rapid writes delivered as 20 events), so an event-count
        // assertion would measure the platform, not the debounce.
        for (let index = 0; index < 25; index += 1) {
          harness.emit([["rename", `note.md.tmp.${index}`]]);
        }
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([["note.md"]]);
        expect(
          harness.ambiguous.filter(
            (event) => event.reason === "ineligible-path"
          )
        ).toHaveLength(25);

        // The load-bearing assertion: the final batch alone cannot show that
        // the WORK coalesced. 25 distinct temp names are one affected directory
        // plus a bounded hint budget, so the enumerations (one per
        // `onReconcileStart`) and store queries stay bounded instead of
        // scaling with the number of unique filenames.
        // MAX_DIRECTORY_HINTS (8) + the affected directory itself. Measured
        // before this fix: 26 enumerations and 25 store queries, one of each
        // per unique temp filename.
        const workBudget = 9;
        expect(harness.started.length).toBe(workBudget);
        expect(calls.length).toBe(workBudget);
        // The degradation at the budget is visible rather than silent.
        expect(harness.ambiguous).toContainEqual({
          collection: "notes",
          directory: "",
          reason: "hint-budget-exhausted",
        });

        // One reconciliation of the collection root, not 25.
        expect(
          harness.completed.filter((event) => event.directory === "")
        ).toHaveLength(1);
        expect(harness.completed[0]).toMatchObject({
          collection: "notes",
          directory: "",
          candidateCount: 1,
          syncedCount: 1,
        });
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "deactivates only the DIRECT indexed children of a deleted directory (R12 boundary)",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-r12-"));
      const { store, calls } = createRecordingStore({
        dir1: ["dir1/a.md"],
        "dir1/sub": ["dir1/sub/deep.md"],
      });
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "dir1"]]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([["dir1/a.md"]]);
        // DOCUMENTED LIMITATION (R12): staying directory-bounded means a
        // document nested deeper than one level below the deleted directory is
        // NOT deactivated here and still needs `gno update`. Asserted so the
        // boundary is tested rather than silently assumed.
        expect(harness.batches[0]).not.toContain("dir1/sub/deep.md");
        expect(calls).not.toContain("dir1/sub");
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "dedupes an exact event and its ambiguous sibling into one batch",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-dedupe-"));
      await Bun.write(join(root, "note.md"), "# atomic\n");
      const { store } = createRecordingStore({ "": ["note.md"] });
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([
          ["rename", "note.md"],
          ["rename", "note.md.tmp"],
        ]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([["note.md"]]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "keeps suppressed application writes suppressed inside a reconciled directory",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-suppress-"));
      await Bun.write(join(root, "note.md"), "# written by gno\n");
      const { store } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.service.suppress(join(root, "note.md"));
        harness.emit([["rename", "note.md.tmp"]]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "reports a store failure and infers no deactivation from it",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-store-fail-"));
      await Bun.write(join(root, "note.md"), "# atomic\n");
      const { store } = createRecordingStore({}, "fail");
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "note.md.tmp"]]);
        expect(await harness.settle()).toBe("settled");

        // The disk side still works, so the atomic save is picked up; nothing
        // is deactivated, because the indexed side never answered.
        expect(harness.batches).toEqual([["note.md"]]);
        expect(harness.failed.some((event) => event.stage === "store")).toBe(
          true
        );
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test.skipIf(process.getuid?.() === 0)(
    "fails closed on an unreadable directory, reports it, and stays armed",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-eacces-"));
      await mkdir(join(root, "locked"), { recursive: true });
      await Bun.write(join(root, "locked", "note.md"), "# locked\n");
      await Bun.write(join(root, "after.md"), "# after\n");
      await chmod(join(root, "locked"), 0o000);
      const { store, calls } = createRecordingStore({
        locked: ["locked/note.md"],
      });
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "locked"]]);
        expect(await harness.settle()).toBe("settled");

        // An unreadable directory is never read as an authoritative empty
        // directory: nothing syncs, nothing deactivates, the cause is visible,
        // and the indexed side is not even consulted for it.
        expect(harness.batches).toEqual([]);
        expect(calls).toEqual([]);
        expect(harness.failed).toHaveLength(1);
        expect(harness.failed[0]).toMatchObject({
          collection: "notes",
          directory: "locked",
          stage: "enumerate",
        });

        // The watcher is still armed after the failure.
        harness.emit([["change", "after.md"]]);
        expect(await harness.settle()).toBe("settled");
        expect(harness.batches).toEqual([["after.md"]]);
      } finally {
        await chmod(join(root, "locked"), 0o700).catch(() => undefined);
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "drops a null filename without throwing and reports it as ambiguous",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-null-"));
      await Bun.write(join(root, "note.md"), "# note\n");
      const { store, calls } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        expect(() => harness.emit([["change", null]])).not.toThrow();

        // Deterministic, no sleep: a dropped event queues nothing at all.
        expect(harness.service.getState().queuedCollections).toEqual([]);
        expect(harness.ambiguous).toEqual([
          { collection: "notes", directory: null, reason: "missing-filename" },
        ]);
        expect(calls).toEqual([]);
        expect(harness.batches).toEqual([]);

        harness.emit([["change", "note.md"]]);
        expect(await harness.settle()).toBe("settled");
        expect(harness.batches).toEqual([["note.md"]]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "recovers with a full sync when the configuration changes DURING enumeration",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-mid-enum-"));
      // Only `.txt` exists on disk. Under the ORIGINAL `**/*.md` rules the
      // reconciliation legitimately produces nothing, so an empty batch must
      // not be mistaken for "no work": the rules changed while the async
      // enumeration was in flight, and `note.txt` is newly eligible.
      await Bun.write(join(root, "note.txt"), "# txt\n");
      const syncCollection = mock(async () => createSyncResult());
      defaultSyncService.syncCollection =
        syncCollection as typeof defaultSyncService.syncCollection;

      let harness: ReturnType<typeof createReconcileHarness> | null = null;
      let swapped = false;
      // The store seam is the controllable point INSIDE the enumeration: it is
      // awaited half-way through reconciling a directory.
      const store = {
        listActiveDirectChildSourcePaths() {
          if (!swapped) {
            swapped = true;
            const retargeted = createCollection("notes", root);
            retargeted.pattern = "**/*.txt";
            harness?.service.updateCollections([retargeted]);
          }
          return Promise.resolve({ ok: true as const, value: [] });
        },
      };
      harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "note.txt.tmp"]]);
        expect(await harness.settle()).toBe("settled");

        // The old rules matched nothing, so no bounded batch was ever synced.
        expect(harness.batches).toEqual([]);
        expect(swapped).toBe(true);
        // Generation drift during enumeration must still reach the
        // full-collection recovery; otherwise `note.txt` is never discovered.
        expect(syncCollection).toHaveBeenCalledTimes(1);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "isolates throwing diagnostic observers from the watcher callback (R7/R9)",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-throwing-obs-"));
      await Bun.write(join(root, "note.md"), "# atomic\n");
      const { store } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
        throwFromDiagnostics: true,
      });

      try {
        harness.service.start();

        // Null-filename branch: the observer throws before the early return.
        expect(() => harness.emit([["change", null]])).not.toThrow();
        // Ineligible-filename branch: the observer throws BEFORE the dirty
        // directory is queued, so an unguarded call would also silently cancel
        // the reconciliation, not just escape the watcher callback.
        expect(() => harness.emit([["rename", "note.md.tmp"]])).not.toThrow();

        expect(await harness.settle()).toBe("settled");
        // Reconciliation still happened despite every observer throwing.
        expect(harness.batches).toEqual([["note.md"]]);
        expect(harness.ambiguous).toHaveLength(2);
        expect(harness.started).toHaveLength(2);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "drops queued reconciliation when the collection root changes before the flush",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-root-change-"));
      const moved = await mkdtemp(join(tmpdir(), "gno-watch-root-moved-"));
      await Bun.write(join(root, "note.md"), "# stale\n");
      const { store, calls } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "note.md.tmp"]]);
        expect(harness.service.getState().queuedCollections).toEqual(["notes"]);

        harness.service.updateCollections([createCollection("notes", moved)]);
        expect(harness.service.getState().queuedCollections).toEqual([]);

        await Bun.sleep(350);
        expect(harness.batches).toEqual([]);
        expect(calls).toEqual([]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
        await rm(moved, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "honors collection filters changed before a queued reconciliation flushes",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-live-rules-"));
      await mkdir(join(root, "drafts"), { recursive: true });
      await Bun.write(join(root, "drafts", "note.md"), "# draft\n");
      const { store } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
      });

      try {
        harness.service.start();
        harness.emit([["rename", "drafts/note.md.tmp"]]);
        const excluded = createCollection("notes", root);
        excluded.exclude = ["drafts"];
        harness.service.updateCollections([excluded]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "emits nothing for unchanged neighbours pulled into a reconciliation batch",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-neighbour-"));
      await Bun.write(join(root, "changed.md"), "# changed\n");
      await Bun.write(join(root, "neighbour.md"), "# unchanged\n");
      const emit = mock((_event: unknown) => undefined);
      const notifySyncComplete = mock((_relPaths: string[]) => undefined);
      const { store } = createRecordingStore({});
      const harness = createReconcileHarness(createCollection("notes", root), {
        store,
        eventBus: { emit },
        scheduler: { notifySyncComplete },
        syncResult: (relPaths) =>
          createSyncResult({
            filesProcessed: relPaths.length,
            filesUpdated: 1,
            filesUnchanged: relPaths.length - 1,
            files: relPaths.map((relPath) => ({
              relPath,
              status: relPath === "changed.md" ? "updated" : "unchanged",
            })),
          }),
      });

      try {
        harness.service.start();
        harness.emit([["rename", "changed.md.tmp"]]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([["changed.md", "neighbour.md"]]);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0]?.[0]).toMatchObject({
          relPath: "changed.md",
        });
        expect(notifySyncComplete).toHaveBeenCalledTimes(1);
        expect(notifySyncComplete).toHaveBeenCalledWith(["changed.md"]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "reconciles a deleted record container through its physical source path (R10)",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-records-"));
      const collection = createCollection("notes", root);
      collection.pattern = "**/*.jsonl";
      collection.include = [".jsonl"];
      // The store seam returns the DISTINCT effective source path
      // (COALESCE(record_source_path, rel_path)), so every logical record
      // derived from the container reconciles through the one physical path.
      const { store } = createRecordingStore({
        records: ["records/export.jsonl"],
      });
      const harness = createReconcileHarness(collection, { store });

      try {
        harness.service.start();
        harness.emit([["rename", "records"]]);
        expect(await harness.settle()).toBe("settled");

        expect(harness.batches).toEqual([["records/export.jsonl"]]);
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );

  test(
    "causes no unbounded collection work for unrelated excluded-path noise",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-noise-"));
      await mkdir(join(root, ".obsidian"), { recursive: true });
      await Bun.write(join(root, "note.md"), "# note\n");
      const syncCollection = mock(async () => createSyncResult());
      defaultSyncService.syncCollection =
        syncCollection as typeof defaultSyncService.syncCollection;
      const collection = createCollection("notes", root);
      collection.exclude = [".obsidian"];
      const { store, calls } = createRecordingStore({});
      const harness = createReconcileHarness(collection, { store });

      try {
        harness.service.start();
        harness.emit([
          ["change", ".obsidian/workspace.json"],
          ["change", ".obsidian/.sync.lock"],
        ]);

        // Excluded and dot-prefixed areas are never walked by a full sync
        // either, so they queue no reconciliation at all - deterministic,
        // no sleep required.
        expect(harness.service.getState().queuedCollections).toEqual([]);
        expect(harness.batches).toEqual([]);
        expect(calls).toEqual([]);
        expect(syncCollection).not.toHaveBeenCalled();
      } finally {
        await harness.service.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
    RED_TEST_TIMEOUT_MS
  );
});
