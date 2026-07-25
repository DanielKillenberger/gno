import { afterEach, describe, expect, test } from "bun:test";
// node:fs/promises, node:os, and node:path provide temporary lock structure.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JobManager } from "../../src/core/job-manager";
import { safeRm } from "../helpers/cleanup";

describe("job manager egress authorization epoch", () => {
  let root = "";

  afterEach(async () => {
    if (root) await safeRm(root);
  });

  test("rejects queued work after a policy change instead of inheriting relaxation", async () => {
    root = await mkdtemp(join(tmpdir(), "gno-job-egress-"));
    let releaseAdmission: (() => void) | undefined;
    const admission = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    let ran = false;
    const manager = new JobManager({
      lockPath: join(root, "write.lock"),
      serverInstanceId: "test",
      toolMutex: {
        acquire: async () => {
          await admission;
          return () => undefined;
        },
      },
    });
    manager.setAuthorizationEpoch("epoch-before");
    const jobId = await manager.startJob("sync", async () => {
      ran = true;
      return {
        collections: [],
        totalDurationMs: 0,
        totalFilesProcessed: 0,
        totalFilesAdded: 0,
        totalFilesUpdated: 0,
        totalFilesErrored: 0,
        totalFilesSkipped: 0,
      };
    });
    expect(manager.setAuthorizationEpoch("epoch-after")).toBe(1);
    releaseAdmission?.();
    await manager.shutdown();
    expect(ran).toBeFalse();
    expect(manager.getJob(jobId)).toMatchObject({
      status: "failed",
      error:
        "STALE_EGRESS_POLICY: collection policy changed; retry to re-authorize",
    });
  });
});
