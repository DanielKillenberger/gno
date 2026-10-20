import { expect, test } from "bun:test";
// node:fs/promises, node:os, and node:path provide temporary index structure.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../../src/mcp/server";

import { JobManager } from "../../src/core/job-manager";
import { Mutex } from "../../src/mcp/context";
import { runTool } from "../../src/mcp/tools/index";
import { SqliteAdapter } from "../../src/store";
import { safeRm } from "../helpers/cleanup";

const READ_DEADLINE_MS = 1000;

const emptySync = {
  collections: [],
  totalDurationMs: 0,
  totalFilesProcessed: 0,
  totalFilesAdded: 0,
  totalFilesUpdated: 0,
  totalFilesErrored: 0,
  totalFilesSkipped: 0,
};

test("a read tool completes while an index job is still running", async () => {
  const toolMutex = new Mutex();
  const manager = new JobManager({
    lockPath: "unused",
    serverInstanceId: "test",
    toolMutex,
  });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let lockReleased = false;
  const jobId = await manager.startTypedJobWithLock(
    "index",
    {
      release: async () => {
        lockReleased = true;
      },
    },
    async () => {
      entered.resolve();
      await finish.promise;
      return { kind: "embed", value: { embedded: 1, errors: 0 } };
    }
  );
  await entered.promise;

  const ctx = {
    isShuttingDown: () => false,
    toolMutex,
    collections: [],
  } as unknown as ToolContext;
  const read = runTool(
    ctx,
    "gno_status",
    async () => ({ healthy: true }),
    () => "ok"
  );
  const outcome = await Promise.race([
    read.then((result) => result),
    Bun.sleep(READ_DEADLINE_MS).then(() => "timed out" as const),
  ]);

  expect(outcome).not.toBe("timed out");
  expect(outcome).toMatchObject({ structuredContent: { healthy: true } });
  expect(manager.getJob(jobId)?.status).toBe("running");

  finish.resolve();
  await manager.shutdown();
  expect(manager.getJob(jobId)).toMatchObject({
    status: "completed",
    typedResult: { kind: "embed", value: { embedded: 1, errors: 0 } },
  });
  expect(lockReleased).toBeTrue();
});

test("a job waits for the tool call in progress before it starts", async () => {
  const toolMutex = new Mutex();
  const manager = new JobManager({
    lockPath: "unused",
    serverInstanceId: "test",
    toolMutex,
  });
  const releaseTool = await toolMutex.acquire();
  let started = false;
  const jobId = await manager.startTypedJobWithLock(
    "embed",
    { release: async () => {} },
    async () => {
      started = true;
      return { kind: "embed", value: { embedded: 0, errors: 0 } };
    }
  );
  await Bun.sleep(10);
  expect(started).toBeFalse();

  releaseTool();
  await manager.shutdown();
  expect(started).toBeTrue();
  expect(manager.getJob(jobId)?.status).toBe("completed");
});

test("reads during a job see only committed rows, including after a rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-job-reads-"));
  const store = new SqliteAdapter();
  try {
    expect(
      (await store.open(join(root, "index-test.sqlite"), "unicode61")).ok
    ).toBeTrue();
    expect(
      (
        await store.syncCollections([
          {
            name: "notes",
            path: root,
            pattern: "**/*",
            include: [],
            exclude: [],
          },
        ])
      ).ok
    ).toBeTrue();
    const manager = new JobManager({
      lockPath: join(root, "write.lock"),
      serverInstanceId: "test",
      toolMutex: new Mutex(),
      runOnJobConnection: (fn) => store.withJobConnection(fn),
    });
    const document = (title: string) => ({
      collection: "notes",
      relPath: "note.md",
      sourceHash: title,
      sourceMime: "text/markdown",
      sourceExt: ".md",
      sourceSize: 1,
      sourceMtime: "2026-10-20T00:00:00.000Z",
      mirrorHash: title,
      title,
    });
    const readTitle = async () => {
      const read = await store.getDocument("notes", "note.md");
      return read.ok ? read.value?.title : "read failed";
    };

    const written = Promise.withResolvers<void>();
    const rollback = Promise.withResolvers<void>();
    const failing = await manager.startJob("sync", async () => {
      const tx = await store.withTransaction(async () => {
        expect(
          (await store.upsertDocument(document("Uncommitted"))).ok
        ).toBeTrue();
        written.resolve();
        await rollback.promise;
        throw new Error("batch failed");
      });
      expect(tx.ok).toBeFalse();
      return emptySync;
    });
    await written.promise;
    expect(await readTitle()).toBeUndefined();
    rollback.resolve();
    await manager.shutdown();
    expect(manager.getJob(failing)?.status).toBe("completed");
    expect(await readTitle()).toBeUndefined();

    const next = new JobManager({
      lockPath: join(root, "write.lock"),
      serverInstanceId: "test",
      toolMutex: new Mutex(),
      runOnJobConnection: (fn) => store.withJobConnection(fn),
    });
    await next.startJob("sync", async () => {
      await store.withTransaction(async () => {
        await store.upsertDocument(document("Committed"));
      });
      return emptySync;
    });
    await next.shutdown();
    expect(await readTitle()).toBe("Committed");
  } finally {
    await store.close();
    await safeRm(root);
  }
});

test("a trace write during a job transaction waits for the commit instead of failing busy", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-job-trace-"));
  const store = new SqliteAdapter();
  try {
    expect(
      (await store.open(join(root, "index-test.sqlite"), "unicode61", 200)).ok
    ).toBeTrue();
    const manager = new JobManager({
      lockPath: join(root, "write.lock"),
      serverInstanceId: "test",
      toolMutex: new Mutex(),
      runOnJobConnection: (fn) => store.withJobConnection(fn),
    });
    const inTransaction = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    const jobId = await manager.startJob("sync", async () => {
      await store.withTransaction(async () => {
        await store.syncCollections([
          {
            name: "notes",
            path: root,
            pattern: "**/*",
            include: [],
            exclude: [],
          },
        ]);
        inTransaction.resolve();
        await commit.promise;
      });
      return emptySync;
    });
    await inTransaction.promise;

    const traceWrite = store.purgeRetrievalTraces();
    await Bun.sleep(400);
    commit.resolve();

    expect((await traceWrite).ok).toBeTrue();
    await manager.shutdown();
    expect(manager.getJob(jobId)?.status).toBe("completed");
  } finally {
    await store.close();
    await safeRm(root);
  }
});
