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
import { createVectorIndexPort } from "../../src/store/vector";
import { safeRm } from "../helpers/cleanup";

const READ_DEADLINE_MS = 1000;

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

test("reads on the read connection during a job see only committed rows, including after a rollback", async () => {
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
    });
    const readTitle = () =>
      store.withReadConnection(async () => {
        const read = await store.getDocument("notes", "note.md");
        return read.ok ? read.value?.title : "read failed";
      });

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

test("writes outside a transaction during a job batch do not fail as locked", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-job-writes-"));
  const store = new SqliteAdapter();
  try {
    // A short busy timeout, as in the resident, so a lock wait fails fast.
    expect(
      (await store.open(join(root, "index-test.sqlite"), "unicode61", 200)).ok
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
    });
    const inTransaction = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    const jobId = await manager.startJob("sync", async () => {
      await store.withTransaction(async () => {
        await store.upsertDocument({ ...document("Batch"), relPath: "b.md" });
        inTransaction.resolve();
        await commit.promise;
      });
      return emptySync;
    });
    await inTransaction.promise;

    // A capture-style direct write and a read tool's trace write, while the
    // batch stays open past the busy timeout.
    const direct = store.upsertDocument(document("Captured"));
    const trace = store.withReadConnection(() => store.purgeRetrievalTraces());
    // A read tool can open a new model's vector tables while the batch writes.
    const vectors = await store.withReadConnection(() =>
      createVectorIndexPort(store.getRawDb(), {
        model: "test-model",
        dimensions: 4,
      })
    );
    expect(vectors.ok && vectors.value.searchAvailable).toBeTrue();
    // A stray write on the read connection fails at once instead of waiting.
    const stray = await store.withReadConnection(async () =>
      store.recordError({
        collection: "notes",
        relPath: "x.md",
        code: "TEST",
        message: "stray",
      })
    );
    expect(stray).toMatchObject({ ok: false });
    await Bun.sleep(400);
    commit.resolve();

    const directResult = await direct;
    const traceResult = await trace;
    expect(directResult.ok ? "ok" : directResult.error.message).toBe("ok");
    expect(traceResult.ok ? "ok" : traceResult.error.message).toBe("ok");
    await manager.shutdown();
    expect(manager.getJob(jobId)?.status).toBe("completed");
  } finally {
    await store.close();
    await safeRm(root);
  }
});

test("vector search on the read connection during a batch ranks and filters committed rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-job-vectors-"));
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
    const mirror = async (name: string) => {
      const hash = new Bun.CryptoHasher("sha256").update(name).digest("hex");
      expect((await store.upsertContent(hash, `# ${name}\n`)).ok).toBeTrue();
      expect(
        (
          await store.upsertChunks(hash, [
            { seq: 0, pos: 0, text: name, startLine: 1, endLine: 1 },
          ])
        ).ok
      ).toBeTrue();
      return hash;
    };
    const committed = await mirror("committed");
    const pending = await mirror("pending");
    expect(
      (
        await store.upsertDocument({
          ...document("Note"),
          mirrorHash: committed,
        })
      ).ok
    ).toBeTrue();
    const model = "test-model";
    const writer = await createVectorIndexPort(store.getRawDb(), {
      model,
      dimensions: 4,
    });
    if (!writer.ok) throw new Error(writer.error.message);
    const embedding = new Float32Array([1, 0, 0, 0]);
    for (const mirrorHash of [committed, pending]) {
      expect(
        (
          await writer.value.upsertVectors([
            { mirrorHash, seq: 0, model, embedFingerprint: "f", embedding },
          ])
        ).ok
      ).toBeTrue();
    }

    const inTransaction = Promise.withResolvers<void>();
    const rollback = Promise.withResolvers<void>();
    const batch = store.withTransaction(async () => {
      // The batch moves the note to new content, then fails.
      await store.upsertDocument({ ...document("Note"), mirrorHash: pending });
      inTransaction.resolve();
      await rollback.promise;
      throw new Error("batch failed");
    });
    await inTransaction.promise;

    const hits = await store.withReadConnection(async () => {
      const port = await createVectorIndexPort(store.getRawDb(), {
        model,
        dimensions: 4,
      });
      if (!port.ok) throw new Error(port.error.message);
      return port.value.searchNearest(embedding, 5, {
        eligibility: { collection: "notes" },
      });
    });
    rollback.resolve();
    await batch;

    expect(hits.ok ? hits.value.map((hit) => hit.mirrorHash) : hits).toEqual([
      committed,
    ]);
  } finally {
    await store.close();
    await safeRm(root);
  }
});

test("vector search on a read connection with no table yet finds nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-job-novec-"));
  const store = new SqliteAdapter();
  try {
    expect(
      (await store.open(join(root, "index-test.sqlite"), "unicode61")).ok
    ).toBeTrue();
    const hits = await store.withReadConnection(async () => {
      const port = await createVectorIndexPort(store.getRawDb(), {
        model: "never-embedded",
        dimensions: 4,
      });
      if (!port.ok) throw new Error(port.error.message);
      expect(port.value.searchAvailable).toBeTrue();
      return port.value.searchNearest(new Float32Array([1, 0, 0, 0]), 5);
    });
    expect(hits).toEqual({ ok: true, value: [] });
  } finally {
    await store.close();
    await safeRm(root);
  }
});
