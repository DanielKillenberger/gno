import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../../src/config/types";

import { CONFIG_VERSION } from "../../src/config/types";
import { SyncService } from "../../src/ingestion/sync";
import { searchBm25 } from "../../src/pipeline/search";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

describe("record provenance refresh", () => {
  let root: string;
  let store: SqliteAdapter;
  let config: Config;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-record-provenance-"));
    store = new SqliteAdapter();
    expect((await store.open(join(root, "index.db"), "unicode61")).ok).toBe(
      true
    );
    config = {
      version: CONFIG_VERSION,
      ftsTokenizer: "unicode61",
      collections: [
        {
          name: "exports",
          path: root,
          pattern: "**/*",
          include: [],
          exclude: [],
          recordAdapters: { jsonl: {} },
        },
      ],
      contexts: [],
    };
    expect((await store.syncCollections(config.collections)).ok).toBe(true);
  });

  afterEach(async () => {
    await store.close();
    await safeRm(root);
  });

  test("refreshes moved stable records and unchanged container metadata", async () => {
    const exportPath = join(root, "records.jsonl");
    const stableRecord = {
      id: "stable",
      title: "Stable evidence",
      text: "The retrieval anchor must follow this record",
    };
    await Bun.write(exportPath, `${JSON.stringify(stableRecord)}\n`);

    const sync = new SyncService();
    await sync.syncCollection(config.collections[0]!, store, {
      projectTypedEdges: false,
    });
    const beforeResult = await store.listRecordDocuments(
      "exports",
      "records.jsonl"
    );
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    const before = beforeResult.value[0];
    expect(before?.recordSourceLocator).toBe("line:1");
    expect(before?.recordAnchors).toEqual([{ kind: "line", value: "1" }]);

    await Bun.sleep(5);
    const insertedRecord = {
      id: "inserted",
      title: "Inserted evidence",
      text: "This row moves the stable record",
    };
    await Bun.write(
      exportPath,
      `${JSON.stringify(insertedRecord)}\n${JSON.stringify(stableRecord)}\n`
    );

    const result = await sync.syncCollection(config.collections[0]!, store, {
      projectTypedEdges: false,
    });
    expect(result.filesUpdated).toBe(1);
    expect(result.files?.[0]?.recordImport?.records).toMatchObject({
      added: 1,
      unchanged: 1,
    });

    const afterResult = await store.listRecordDocuments(
      "exports",
      "records.jsonl"
    );
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    const after = afterResult.value.find(
      (document) => document.recordKey === before?.recordKey
    );
    expect(after?.sourceHash).toBe(before?.sourceHash);
    expect(after?.mirrorHash).toBe(before?.mirrorHash);
    expect(after?.recordSourceLocator).toBe("line:2");
    expect(after?.recordAnchors).toEqual([{ kind: "line", value: "2" }]);
    expect(after?.sourceSize).toBe(Bun.file(exportPath).size);
    expect(after?.sourceSize).toBeGreaterThan(before?.sourceSize ?? 0);
    expect(after?.sourceMtime).not.toBe(before?.sourceMtime);

    const search = await searchBm25(store, "retrieval anchor follow", {
      collection: "exports",
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    const stableResult = search.value.results.find(
      (candidate) => candidate.record?.sourceLocator === "line:2"
    );
    expect(stableResult?.record?.anchors).toEqual([
      { kind: "line", value: "2" },
    ]);
  });
});
