import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// node:fs/promises, node:os, and node:path provide temporary directory structure.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EgressAuditService } from "../../src/core/egress-audit";
import {
  defaultEgressPolicyPort,
  type EgressDecision,
} from "../../src/core/egress-policy";
import { createEgressLineage } from "../../src/core/egress-provenance";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

const retention = {
  maxAgeDays: 30,
  maxReceipts: 100,
  maxBytes: 1024 * 1024,
} as const;

const lineage = createEgressLineage([
  { collection: "notes", policy: "local_only", source: "explicit" },
  { collection: "public", policy: "remote", source: "explicit" },
]);

const decision = (
  zone: "loopback" | "remote",
  contentClass: "capsule" | "retrieval_trace" = "capsule"
): EgressDecision =>
  defaultEgressPolicyPort.evaluate({
    collections: lineage.sources,
    action: zone === "loopback" ? "serve" : "publish",
    destination: { zone },
    caller: { authenticated: true, operationAuthorized: true },
    contentClass,
  });

describe("egress audit receipts", () => {
  let root = "";
  let dbPath = "";
  let store: SqliteAdapter;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-egress-audit-"));
    dbPath = join(root, "index.sqlite");
    store = new SqliteAdapter();
    expect((await store.open(dbPath, "unicode61")).ok).toBe(true);
  });

  afterEach(async () => {
    await store.close();
    await safeRm(root);
  });

  test("stores only bounded content-free allow and deny metadata", async () => {
    let now = 1_000;
    let nextId = 0;
    const service = new EgressAuditService(store, {
      clock: () => now,
      idFactory: () => `audit-${++nextId}`,
    });

    expect(
      await service.record({
        decision: decision("loopback"),
        lineage,
        contentClass: "capsule",
        retention,
      })
    ).toEqual({ ok: true, value: "inserted" });
    now += 1;
    expect(
      await service.record({
        decision: decision("remote"),
        lineage,
        contentClass: "capsule",
        retention,
      })
    ).toEqual({ ok: true, value: "inserted" });

    const listed = await service.list({ limit: 1 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.receipts).toHaveLength(1);
    expect(listed.value.receipts[0]).toMatchObject({
      decision: "deny",
      action: "publish",
      destinationZone: "remote",
      contentClass: "capsule",
      effectivePolicy: "local_only",
      reasonCode: "POLICY_LOCAL_ONLY",
      lineageDigest: lineage.digest,
    });
    expect(listed.value.nextCursor).toStartWith("gno-egress-audit-v1.");
    const secondPage = await service.list({
      limit: 1,
      cursor: listed.value.nextCursor ?? undefined,
    });
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.receipts[0]?.decision).toBe("allow");
      expect(secondPage.value.nextCursor).toBeNull();
    }
    expect((await service.list({ cursor: "not-a-cursor" })).ok).toBe(false);

    const columns = store
      .getRawDb()
      .query<{ name: string }, []>("PRAGMA table_info(egress_audit_receipts)")
      .all()
      .map(({ name }) => name);
    expect(columns).toEqual([
      "audit_id",
      "decision",
      "action",
      "destination_zone",
      "content_class",
      "effective_policy",
      "reason_code",
      "lineage_digest",
      "created_at_ms",
      "expires_at_ms",
      "byte_size",
    ]);
    expect(columns).not.toContain("query_text");
    expect(columns).not.toContain("path");
    expect(columns).not.toContain("credential");
    expect(columns).not.toContain("content");
  });

  test("enforces age, count, and byte retention then physically purges", async () => {
    let now = 10_000;
    let nextId = 0;
    const service = new EgressAuditService(store, {
      clock: () => now,
      idFactory: () => `retained-${++nextId}`,
    });
    for (let index = 0; index < 3; index += 1) {
      expect(
        (
          await service.record({
            decision: decision("loopback", "retrieval_trace"),
            lineage,
            contentClass: "retrieval_trace",
            retention,
          })
        ).ok
      ).toBe(true);
      now += 1;
    }

    const retained = await service.enforceRetention(
      { ...retention, maxReceipts: 2 },
      now
    );
    expect(retained).toMatchObject({
      ok: true,
      value: { deleted: 1, remainingReceipts: 2 },
    });
    store.getRawDb().exec("PRAGMA secure_delete = FAST");
    const priorSecureDelete = store
      .getRawDb()
      .query<{ secure_delete: number }, []>("PRAGMA secure_delete")
      .get()?.secure_delete;
    const purged = await service.purge();
    expect(purged).toMatchObject({
      ok: true,
      value: {
        deleted: 2,
        physicalCleanup: "completed",
        remainingWalFrames: 0,
      },
    });
    expect(
      store
        .getRawDb()
        .query<{ secure_delete: number }, []>("PRAGMA secure_delete")
        .get()?.secure_delete
    ).toBe(priorSecureDelete);
  });

  test("rejects caller-forged decision metadata before persistence", async () => {
    const service = new EgressAuditService(store, {
      clock: () => 50_000,
      idFactory: () => "forged",
    });
    const valid = decision("loopback");
    const forgeries: EgressDecision[] = [
      { ...valid, reason: "POLICY_LOCAL_ONLY" },
      {
        ...valid,
        audit: { ...valid.audit, action: "publish" },
      },
      {
        ...valid,
        audit: { ...valid.audit, contentClass: "retrieval_trace" },
      },
      {
        ...valid,
        audit: { ...valid.audit, collectionCount: 1 },
      },
      {
        ...valid,
        audit: { ...valid.audit, collections: ["notes"] },
      },
      {
        ...valid,
        audit: { ...valid.audit, effectivePolicy: "remote" },
      },
    ];
    for (const forgedDecision of forgeries) {
      expect(
        (
          await service.record({
            decision: forgedDecision,
            lineage,
            contentClass: "capsule",
            retention,
          })
        ).ok
      ).toBe(false);
    }
    const listed = await service.list();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.receipts).toHaveLength(0);
  });

  test("rolls back the inserted receipt when retention fails", async () => {
    let now = 60_000;
    let nextId = 0;
    const service = new EgressAuditService(store, {
      clock: () => now,
      idFactory: () => `atomic-${++nextId}`,
    });
    expect(
      (
        await service.record({
          decision: decision("loopback"),
          lineage,
          contentClass: "capsule",
          retention,
        })
      ).ok
    ).toBe(true);
    store.getRawDb().exec(`
      CREATE TRIGGER fail_egress_retention
      BEFORE DELETE ON egress_audit_receipts
      BEGIN
        SELECT RAISE(ABORT, 'retention fault');
      END;
    `);
    now += 1;
    const failed = await service.record({
      decision: decision("loopback"),
      lineage,
      contentClass: "capsule",
      retention: { ...retention, maxReceipts: 1 },
    });
    expect(failed.ok).toBe(false);
    const rows = store
      .getRawDb()
      .query<{ audit_id: string }, []>(
        "SELECT audit_id FROM egress_audit_receipts ORDER BY audit_id"
      )
      .all();
    expect(rows).toEqual([{ audit_id: "atomic-1" }]);
  });

  test("keeps concurrent writes within deterministic count and byte bounds", async () => {
    let nextId = 0;
    const bounded = { ...retention, maxReceipts: 5, maxBytes: 2048 };
    const service = new EgressAuditService(store, {
      clock: () => 70_000,
      idFactory: () => `concurrent-${++nextId}`,
    });
    const writes = await Promise.all(
      Array.from({ length: 25 }, () =>
        service.record({
          decision: decision("loopback"),
          lineage,
          contentClass: "capsule",
          retention: bounded,
        })
      )
    );
    expect(writes.every((result) => result.ok)).toBe(true);
    const aggregate = store
      .getRawDb()
      .query<{ count: number; bytes: number }, []>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes
         FROM egress_audit_receipts`
      )
      .get();
    expect(aggregate?.count).toBeLessThanOrEqual(bounded.maxReceipts);
    expect(aggregate?.bytes).toBeLessThanOrEqual(bounded.maxBytes);
  });
});
