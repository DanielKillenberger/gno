import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// node:path has no Bun path utility equivalent.
import { join } from "node:path";

import { createDefaultConfig } from "../../src/config";
import { legacyLocalOnlyEgressLineage } from "../../src/core/egress-provenance";
import { buildRetrievalQrelsArtifact } from "../../src/core/retrieval-qrels";
import {
  canonicalTraceJson,
  hashTraceCanonical,
  traceUtf8Bytes,
} from "../../src/store/retrieval-trace-codec";
import {
  createReplayTestHarness,
  type ReplayTestHarness,
} from "./retrieval-replay-fixture";

const replayDeps = () => ({
  config: createDefaultConfig(),
  vectorIndex: null,
  embedPort: null,
  expandPort: null,
  rerankPort: null,
  indexName: "default",
});

describe("retrieval replay SQLite invalidation", () => {
  let harness: ReplayTestHarness;

  beforeEach(async () => {
    harness = await createReplayTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("detects shortened manifest membership after a real trace cascade", async () => {
    const first = await harness.buildReceipt({
      traceId: "cascade-a",
      relPath: "projects/cascade-a.md",
    });
    await harness.buildReceipt({
      traceId: "cascade-b",
      relPath: "projects/cascade-b.md",
    });
    const aggregate = await first.service.export({
      traceIds: ["cascade-a", "cascade-b"],
      format: "qrels",
    });
    if (!aggregate.ok) throw new Error(aggregate.error.message);
    const exportId = aggregate.value.manifest.exportId;

    const raw = new Database(join(harness.root, "index.sqlite"));
    raw.run("PRAGMA foreign_keys = ON");
    raw.run("DELETE FROM retrieval_traces WHERE trace_id = ?", ["cascade-b"]);
    const remaining = raw
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count
         FROM retrieval_trace_export_traces WHERE export_id = ?`
      )
      .get(exportId)?.count;
    const manifest = raw
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM retrieval_trace_exports WHERE export_id = ?"
      )
      .get(exportId)?.count;
    raw.close();
    expect(remaining).toBe(1);
    expect(manifest).toBe(1);

    const replayed = await first.service.replay(
      {
        exportId,
        candidate: { id: "cascade-bm25", type: "bm25" },
      },
      replayDeps()
    );
    expect(replayed.ok && replayed.value).toMatchObject({
      verdict: "unreplayable",
      reason: "manifest_hash_mismatch",
      applied: false,
    });
  });

  test("accepts a migrated pre-lineage manifest under its original hash", async () => {
    const { service, exportId } = await harness.buildReceipt();
    const lineage = legacyLocalOnlyEgressLineage();
    const lineageJson = canonicalTraceJson(lineage);
    const raw = harness.store.getRawDb();
    raw.run(
      `UPDATE retrieval_traces
       SET effective_egress_policy = ?, egress_lineage_digest = ?,
           egress_lineage_json = ?, egress_lineage_bytes = ?`,
      [
        lineage.effectivePolicy,
        lineage.digest,
        lineageJson,
        traceUtf8Bytes(lineageJson),
      ]
    );
    raw.run(
      `UPDATE retrieval_trace_exports
       SET effective_egress_policy = ?, egress_lineage_digest = ?,
           egress_lineage_json = ?, egress_lineage_bytes = ?
       WHERE export_id = ?`,
      [
        lineage.effectivePolicy,
        lineage.digest,
        lineageJson,
        traceUtf8Bytes(lineageJson),
        exportId,
      ]
    );
    const migrated =
      await harness.store.getRetrievalTraceExportBundle(exportId);
    if (!(migrated.ok && migrated.value)) {
      throw new Error("Migrated trace export fixture unavailable");
    }
    const artifact = buildRetrievalQrelsArtifact(migrated.value.traces);
    if (!artifact.ok) throw new Error(artifact.error.message);
    const { egressLineage: _migrationProjection, ...legacyArtifact } =
      artifact.value;
    raw.run(
      "UPDATE retrieval_trace_exports SET artifact_hash = ? WHERE export_id = ?",
      [hashTraceCanonical(legacyArtifact), exportId]
    );

    const replayed = await service.replay(
      {
        exportId,
        candidate: { id: "legacy-bm25", type: "bm25" },
      },
      replayDeps()
    );
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.value.reason).not.toBe("manifest_hash_mismatch");
      expect(replayed.value.verdict).not.toBe("unreplayable");
    }
  });

  test("reports source_missing after the indexed document disappears", async () => {
    const { service, exportId } = await harness.buildReceipt();
    const raw = new Database(join(harness.root, "index.sqlite"));
    raw.run("PRAGMA foreign_keys = ON");
    raw.run("DELETE FROM documents WHERE collection = ? AND rel_path = ?", [
      "notes",
      "projects/decision.md",
    ]);
    raw.close();

    const replayed = await service.replay(
      {
        exportId,
        candidate: { id: "missing-bm25", type: "bm25" },
      },
      replayDeps()
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value).toMatchObject({
      verdict: "unreplayable",
      reason: "source_missing",
      cases: [
        {
          verdict: "unreplayable",
          reason: "source_missing",
          qrels: [
            {
              label: "relevant",
              sourceState: "missing",
              candidateRank: null,
            },
            { label: "missing_expected" },
          ],
        },
      ],
    });
  });

  test("resolves a moved source hash before a reused URI", async () => {
    const { service, exportId } = await harness.buildReceipt();
    expect(
      (await harness.store.markInactive("notes", ["projects/decision.md"])).ok
    ).toBe(true);
    await harness.indexDocument(
      "notes",
      "moved/decision.md",
      "Alpha decision approved"
    );
    await harness.indexDocument(
      "notes",
      "projects/decision.md",
      "Alpha decision replacement"
    );

    const replayed = await service.replay(
      {
        exportId,
        candidate: { id: "moved-source-bm25", type: "bm25" },
      },
      replayDeps()
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(
      replayed.value.cases[0]?.qrels.find((qrel) => qrel.label === "relevant")
    ).toMatchObject({
      sourceState: "unchanged",
      candidateRank: 1,
    });
  });

  test("reports a reused URI as stale when its source hash disappeared", async () => {
    const { service, exportId } = await harness.buildReceipt();
    await harness.indexDocument(
      "notes",
      "projects/decision.md",
      "Alpha decision replacement"
    );

    const replayed = await service.replay(
      {
        exportId,
        candidate: { id: "reused-uri-bm25", type: "bm25" },
      },
      replayDeps()
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value).toMatchObject({
      verdict: "unreplayable",
      reason: "source_stale",
      cases: [
        {
          qrels: [
            {
              label: "relevant",
              sourceState: "stale",
            },
            { label: "missing_expected" },
          ],
        },
      ],
    });
  });
});
