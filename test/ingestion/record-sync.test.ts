import { describe, expect, test } from "bun:test";

import type {
  RecordAdapter,
  RecordAdapterEvent,
  RecordAdapterInput,
} from "../../src/converters/types";
import type { StoredRecordState } from "../../src/store/types";

import {
  recordAdapterFingerprint,
  recordKeyFor,
  runRecordAdapter,
} from "../../src/ingestion/record-adapter";
import { reconcileRecordSnapshot } from "../../src/ingestion/record-sync";

const input = (): RecordAdapterInput => ({
  sourcePath: "/private/source/export.jsonl",
  relativePath: "export.jsonl",
  collection: "test",
  mime: "application/x-ndjson",
  ext: ".jsonl",
  open: async function* () {
    yield new TextEncoder().encode("source");
  },
  limits: {
    maxSourceBytes: 1_024,
    maxRecordChars: 1_000,
    maxMetadataChars: 1_000,
    maxTotalChars: 5_000,
    maxRecords: 10,
    maxFailures: 10,
  },
});

const record = (stableId: string, markdown: string): RecordAdapterEvent => ({
  type: "record",
  record: { stableId, sourceLocator: `line:${stableId}`, markdown },
});

const complete: RecordAdapterEvent = {
  type: "snapshot",
  state: "complete",
};

const adapter = (
  events: RecordAdapterEvent[],
  version = "1.0.0"
): RecordAdapter => ({
  id: "adapter/test-records",
  version,
  canHandle: () => true,
  records: async function* () {
    for (const event of events) yield event;
  },
});

const prior = (stableId: string, active = true): StoredRecordState => ({
  recordKey: recordKeyFor("adapter/test-records", stableId),
  sourceHash: "a".repeat(64),
  adapterVersion: "1.0.0",
  adapterFingerprint: recordAdapterFingerprint(adapter([])),
  active,
  relativePath: `container/.gno-records/${stableId}.md`,
});

describe("record snapshot reconciliation", () => {
  test("complete snapshots add, update, reactivate, and deactivate", async () => {
    const snapshot = await runRecordAdapter(
      adapter([
        record("updated", "new"),
        record("new", "added"),
        record("revive", "back"),
        complete,
      ]),
      input()
    );
    const plan = reconcileRecordSnapshot(
      [prior("updated"), prior("removed"), prior("revive", false)],
      snapshot
    );

    expect(plan.authoritative).toBe(true);
    expect(plan.actions.map((action) => action.type).sort()).toEqual([
      "add",
      "deactivate",
      "reactivate",
      "update",
    ]);
  });

  test("an authoritative empty snapshot deactivates all active records", async () => {
    const snapshot = await runRecordAdapter(adapter([complete]), input());
    const plan = reconcileRecordSnapshot(
      [prior("one"), prior("two")],
      snapshot
    );

    expect(plan.authoritative).toBe(true);
    expect(plan.actions.every((action) => action.type === "deactivate")).toBe(
      true
    );
  });

  test("partial and failed snapshots never tombstone unseen siblings", async () => {
    const partial = await runRecordAdapter(
      adapter([
        record("updated", "new"),
        { type: "snapshot", state: "partial" },
      ]),
      input()
    );
    const plan = reconcileRecordSnapshot(
      [prior("updated"), prior("unseen")],
      partial
    );

    expect(plan.authoritative).toBe(false);
    expect(
      plan.actions.find(
        (action) =>
          "previous" in action &&
          action.previous.recordKey === prior("unseen").recordKey
      )?.type
    ).toBe("preserve");
    expect(plan.actions.some((action) => action.type === "deactivate")).toBe(
      false
    );
  });

  test("same hash/version is unchanged while a new adapter version updates", async () => {
    const current = await runRecordAdapter(
      adapter([record("same", "same"), complete]),
      input()
    );
    const canonical = current.records[0];
    if (!canonical) throw new Error("missing canonical fixture");
    const previous: StoredRecordState = {
      ...prior("same"),
      sourceHash: canonical.sourceHash,
    };
    const unchanged = reconcileRecordSnapshot([previous], current);
    const upgraded = await runRecordAdapter(
      adapter([record("same", "same"), complete], "2.0.0"),
      input()
    );

    expect(unchanged.actions[0]?.type).toBe("unchanged");
    expect(reconcileRecordSnapshot([previous], upgraded).actions[0]?.type).toBe(
      "update"
    );
  });
});
