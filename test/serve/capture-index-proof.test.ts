/**
 * The REST write paths hand back a 202 and a job id, so the job is where this
 * write is claimed to have succeeded.
 *
 * `syncCollection` returning without an error is not that proof: a path the
 * walker cannot reach, or one the collection excludes, is `skipped` - an
 * ordinary non-error. A job reporting `completed` for a file that is not in the
 * index would move the silent success one step downstream, not remove it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// node:fs/promises has no Bun equivalent for directory creation.
import { mkdir, mkdtemp } from "node:fs/promises";
// node:os has no Bun temp-directory helper.
import { tmpdir } from "node:os";
// node:path has no Bun path utilities.
import { join } from "node:path";

import type { Config } from "../../src/config/types";
import type { CollectionSyncResult } from "../../src/ingestion";
import type { ContextHolder } from "../../src/serve/routes/api";

import { getJobStatus } from "../../src/serve/jobs";
import {
  handleCreateCapture,
  handleCreateDoc,
} from "../../src/serve/routes/api";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

/** A sync that reports a clean pass and indexes nothing - the `skipped` case. */
const indexNothing = async (): Promise<CollectionSyncResult> => ({
  collection: "notes",
  filesProcessed: 1,
  filesAdded: 0,
  filesUpdated: 0,
  filesUnchanged: 0,
  filesErrored: 0,
  filesSkipped: 1,
  filesMarkedInactive: 0,
  durationMs: 1,
  errors: [],
});

const settledJob = async (jobId: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = getJobStatus(jobId);
    if (status && status.status !== "running") return status;
    await Bun.sleep(10);
  }
  throw new Error("Job never settled");
};

describe("REST write jobs demand an indexed document", () => {
  let root: string;
  let store: SqliteAdapter;
  let ctxHolder: ContextHolder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-capture-proof-"));
    await mkdir(join(root, "notes"), { recursive: true });
    store = new SqliteAdapter();
    const opened = await store.open(join(root, "index.sqlite"), "unicode61");
    if (!opened.ok) throw new Error(opened.error.message);
    const config: Config = {
      version: "1.0",
      ftsTokenizer: "unicode61",
      collections: [
        {
          name: "notes",
          path: join(root, "notes"),
          pattern: "**/*.md",
          include: [],
          exclude: [],
        },
      ],
      contexts: [],
    };
    ctxHolder = {
      current: { config } as ContextHolder["current"],
      config,
      scheduler: null,
      eventBus: null,
      watchService: null,
    } as ContextHolder;
  });

  afterEach(async () => {
    await store.close();
    await safeRm(root);
  });

  test("a capture whose file never gets indexed fails its sync job", async () => {
    // DISCRIMINATING: at ede2ed1a this job reported `completed`, so a client
    // polling /api/jobs/:id was told the capture had succeeded.
    const res = await handleCreateCapture(
      ctxHolder,
      store,
      new Request("http://localhost/api/capture", {
        method: "POST",
        body: JSON.stringify({
          collection: "notes",
          title: "Unindexed capture",
          content: "# Unindexed capture\n",
          relPath: "captures/ghost.md",
        }),
      }),
      { syncCollection: indexNothing }
    );

    expect(res.status).toBe(202);
    const receipt = (await res.json()) as { sync: { jobId: string } };
    const job = await settledJob(receipt.sync.jobId);

    expect(job.status).toBe("failed");
    expect(job.error).toContain("not indexed");
    // The file itself is on disk; only the success claim is withheld.
    expect(
      await Bun.file(join(root, "notes", "captures", "ghost.md")).exists()
    ).toBe(true);
  });

  test("a created note that never gets indexed fails its sync job", async () => {
    // DISCRIMINATING: at ede2ed1a this job reported `completed` for a `gno://`
    // URI that resolves to nothing.
    const res = await handleCreateDoc(
      ctxHolder,
      store,
      new Request("http://localhost/api/docs", {
        method: "POST",
        body: JSON.stringify({
          collection: "notes",
          relPath: "created/ghost.md",
          title: "Unindexed note",
          content: "# Unindexed note\n",
        }),
      }),
      { syncCollection: indexNothing }
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    const job = await settledJob(body.jobId);

    expect(job.status).toBe("failed");
    expect(job.error).toContain("not indexed");
  });
});
