import { expect, test } from "bun:test";

import type { ToolContext } from "../../src/mcp/server";

import { JobManager } from "../../src/core/job-manager";
import { Mutex } from "../../src/mcp/context";
import { runTool } from "../../src/mcp/tools/index";

const READ_DEADLINE_MS = 1000;

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
