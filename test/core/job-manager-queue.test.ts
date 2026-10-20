import { afterEach, beforeEach, expect, test } from "bun:test";
// node:fs/promises, node:os, and node:path provide temporary lock structure.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireWriteLock } from "../../src/core/file-lock";
import {
  JobError,
  type JobResult,
  JobManager,
  MAX_PENDING_REINDEX_JOBS,
  type ReindexRequest,
  reindexKey,
} from "../../src/core/job-manager";
import { withInferenceScope } from "../../src/llm/inference-scope";
import { Mutex } from "../../src/mcp/context";
import { safeRm } from "../helpers/cleanup";

const done: JobResult = {
  kind: "sync",
  value: {
    collections: [],
    totalDurationMs: 0,
    totalFilesProcessed: 0,
    totalFilesAdded: 0,
    totalFilesUpdated: 0,
    totalFilesErrored: 0,
    totalFilesSkipped: 0,
  },
};

let root = "";
let manager: JobManager;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gno-reindex-queue-"));
  manager = new JobManager({
    lockPath: join(root, "write.lock"),
    serverInstanceId: "test",
    toolMutex: new Mutex(),
  });
});

afterEach(async () => {
  await manager.shutdown();
  await safeRm(root);
});

const submit = (request: ReindexRequest) =>
  withInferenceScope({}, () => manager.submitReindex(request));

/** A run that records its calls and waits until released. */
function gatedRun() {
  const calls: Array<string[] | null> = [];
  const started: Array<PromiseWithResolvers<void>> = [];
  const gates: Array<PromiseWithResolvers<void>> = [];
  const run: ReindexRequest["run"] = async (paths) => {
    calls.push(paths);
    started[calls.length - 1]?.resolve();
    await gates[calls.length - 1]?.promise;
    return done;
  };
  const step = (n: number) => {
    while (gates.length <= n) {
      gates.push(Promise.withResolvers<void>());
      started.push(Promise.withResolvers<void>());
    }
    return { started: started[n]!.promise, release: () => gates[n]!.resolve() };
  };
  return { calls, run, step };
}

const key = (collection: string) =>
  reindexKey("sync", collection, { gitPull: false, runUpdateCmd: false });

test("a single request starts immediately and completes", async () => {
  const { run, step } = gatedRun();
  const first = step(0);
  const accepted = await submit({
    type: "sync",
    key: key("notes"),
    paths: null,
    run,
  });
  expect(accepted.status).toBe("running");
  await first.started;
  first.release();
  await manager.shutdown();
  expect(manager.getJob(accepted.jobId)?.status).toBe("completed");
});

test("a request while a job runs is queued, then runs after it", async () => {
  const { calls, run, step } = gatedRun();
  const first = step(0);
  const second = step(1);
  const running = await submit({
    type: "sync",
    key: key("a"),
    paths: null,
    run,
  });
  await first.started;

  const queued = await submit({
    type: "sync",
    key: key("b"),
    paths: null,
    run,
  });
  expect(queued.status).toBe("queued");
  expect(manager.getJob(queued.jobId)?.status).toBe("queued");
  expect(calls).toHaveLength(1);

  first.release();
  await second.started;
  expect(manager.getJob(running.jobId)?.status).toBe("completed");
  expect(manager.getJob(queued.jobId)?.status).toBe("running");
  second.release();
  await manager.shutdown();
  expect(manager.getJob(queued.jobId)?.status).toBe("completed");
});

test("many requests for one scope coalesce into one more pass over the union of paths", async () => {
  const { calls, run, step } = gatedRun();
  const first = step(0);
  const second = step(1);
  await submit({ type: "sync", key: key("notes"), paths: ["a.md"], run });
  await first.started;

  const ids = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const accepted = await submit({
      type: "sync",
      key: key("notes"),
      paths: [`doc-${i % 3}.md`],
      run,
    });
    expect(accepted.status).toBe("queued");
    ids.add(accepted.jobId);
  }
  expect(ids.size).toBe(1);

  first.release();
  await second.started;
  second.release();
  await manager.shutdown();
  expect(calls).toHaveLength(2);
  expect([...(calls[1] ?? [])].sort()).toEqual([
    "doc-0.md",
    "doc-1.md",
    "doc-2.md",
  ]);
});

test("a whole-scope request absorbs a pending path list", async () => {
  const { calls, run, step } = gatedRun();
  const first = step(0);
  const second = step(1);
  await submit({ type: "sync", key: key("notes"), paths: null, run });
  await first.started;
  const a = await submit({
    type: "sync",
    key: key("notes"),
    paths: ["a.md"],
    run,
  });
  const b = await submit({ type: "sync", key: key("notes"), paths: null, run });
  const c = await submit({
    type: "sync",
    key: key("notes"),
    paths: ["c.md"],
    run,
  });
  expect(new Set([a.jobId, b.jobId, c.jobId]).size).toBe(1);
  first.release();
  await second.started;
  second.release();
  await manager.shutdown();
  expect(calls).toEqual([null, null]);
});

test("the pending bound rejects further scopes with QUEUE_FULL", async () => {
  const { run, step } = gatedRun();
  const first = step(0);
  await submit({ type: "sync", key: key("running"), paths: null, run });
  await first.started;
  for (let i = 0; i < MAX_PENDING_REINDEX_JOBS; i += 1) {
    await submit({ type: "sync", key: key(`c${i}`), paths: null, run });
  }
  const full = submit({ type: "sync", key: key("one-more"), paths: null, run });
  expect(full).rejects.toMatchObject({ code: "QUEUE_FULL" });
  await full.catch(() => undefined);
  // Merging into a scope that already waits still works at the bound.
  const merged = await submit({
    type: "sync",
    key: key("c0"),
    paths: null,
    run,
  });
  expect(merged.status).toBe("queued");
  manager.stop();
  first.release();
});

test("an immediate start reports LOCKED while another process holds the write lease", async () => {
  const held = await acquireWriteLock(join(root, "write.lock"), 1000);
  expect(held).not.toBeNull();
  const short = new JobManager({
    lockPath: join(root, "write.lock"),
    serverInstanceId: "test",
    toolMutex: new Mutex(),
    lockTimeoutMs: 100,
  });
  try {
    const attempt = withInferenceScope({}, () =>
      short.submitReindex({
        type: "sync",
        key: key("notes"),
        paths: null,
        run: async () => done,
      })
    );
    expect(attempt).rejects.toBeInstanceOf(JobError);
    expect(attempt).rejects.toMatchObject({ code: "LOCKED" });
    await attempt.catch(() => undefined);
    expect(short.listJobs().active).toHaveLength(0);
  } finally {
    await held?.release();
    await short.shutdown();
  }
});

test("queued work is failed at shutdown and unknown to a restarted process", async () => {
  const { run, step } = gatedRun();
  const first = step(0);
  await submit({ type: "sync", key: key("a"), paths: null, run });
  await first.started;
  const queued = await submit({
    type: "sync",
    key: key("b"),
    paths: null,
    run,
  });

  manager.stop();
  expect(manager.getJob(queued.jobId)).toMatchObject({
    status: "failed",
    error: "Resident runtime is shutting down",
  });
  first.release();
  await manager.shutdown();

  const restarted = new JobManager({
    lockPath: join(root, "write.lock"),
    serverInstanceId: "restarted",
    toolMutex: new Mutex(),
  });
  expect(restarted.getJob(queued.jobId)).toBeUndefined();
});

test("queued work accepted before a policy change fails instead of running", async () => {
  const { calls, run, step } = gatedRun();
  const first = step(0);
  manager.setAuthorizationEpoch("before");
  await submit({ type: "sync", key: key("a"), paths: null, run });
  await first.started;
  const queued = await submit({
    type: "sync",
    key: key("b"),
    paths: null,
    run,
  });
  expect(manager.setAuthorizationEpoch("after")).toBe(2);
  first.release();
  while (manager.getJob(queued.jobId)?.status === "queued") await Bun.sleep(5);
  await manager.shutdown();
  expect(calls).toHaveLength(1);
  expect(manager.getJob(queued.jobId)).toMatchObject({
    status: "failed",
    error:
      "STALE_EGRESS_POLICY: collection policy changed; retry to re-authorize",
  });
});
