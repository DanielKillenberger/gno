import type { WatchListener } from "node:fs";

import { afterEach, describe, expect, mock, test } from "bun:test";
// node:fs/promises is used for mkdtemp/mkdir/rm: Bun has no native equivalents
// for temp-directory creation or filesystem structure operations.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
