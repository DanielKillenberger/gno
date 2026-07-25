import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// node:fs/promises, node:os, and node:path provide temporary directory structure.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SearchResults } from "../../src/pipeline/types";

import { createEgressLineage } from "../../src/core/egress-provenance";
import { RetrievalTraceSession } from "../../src/core/retrieval-trace-session";
import { SEARCH_RESULT_PLANNER_METADATA } from "../../src/pipeline/types";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

const HASH = {
  config: "a".repeat(64),
  index: "b".repeat(64),
  mirror: "c".repeat(64),
  model: "d".repeat(64),
  passage: "e".repeat(64),
  pipeline: "f".repeat(64),
  source: "1".repeat(64),
};
const config = {
  enabled: true,
  redactionMode: "replay",
  retention: {
    maxAgeDays: 30,
    maxTraces: 100,
    maxRecordsPerTrace: 100,
    maxBytes: 1024 * 1024,
  },
} as const;

describe("retrieval trace egress lineage", () => {
  let adapter: SqliteAdapter;
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-trace-egress-"));
    adapter = new SqliteAdapter();
    expect(
      (await adapter.open(join(root, "index.sqlite"), "unicode61")).ok
    ).toBe(true);
    expect(
      (
        await adapter.syncCollections([
          {
            name: "local",
            path: join(root, "local"),
            pattern: "**/*",
            include: [],
            exclude: [],
            egressPolicy: "local_only",
          },
          {
            name: "remote",
            path: join(root, "remote"),
            pattern: "**/*",
            include: [],
            exclude: [],
            egressPolicy: "remote",
          },
        ])
      ).ok
    ).toBe(true);
  });

  afterEach(async () => {
    await adapter.close();
    await safeRm(root);
  });

  test("starts at the selected scope then widens to shared-result ownership", async () => {
    const started = await RetrievalTraceSession.start({
      store: adapter,
      config,
      query: "shared decision",
      filters: { collection: "remote" },
      fingerprints: () => ({
        pipeline: HASH.pipeline,
        model: HASH.model,
        config: HASH.config,
        index: HASH.index,
      }),
      idFactory: () => "trace-egress-selected",
      clock: () => 1_000,
    });
    expect(started.ok).toBe(true);
    if (!(started.ok && started.value)) return;
    const initial = await adapter.getRetrievalTrace("trace-egress-selected");
    expect(initial.ok && initial.value?.trace.egressLineage.sources).toEqual([
      { collection: "remote", policy: "remote", source: "explicit" },
    ]);

    const mixedLineage = createEgressLineage([
      { collection: "local", policy: "local_only", source: "explicit" },
      { collection: "remote", policy: "remote", source: "explicit" },
    ]);
    const results: SearchResults = {
      results: [
        {
          docid: "#abcdef",
          score: 0.9,
          uri: "gno://remote/shared.md",
          snippet: "shared decision",
          snippetRange: { startLine: 1, endLine: 1 },
          source: {
            relPath: "shared.md",
            mime: "text/markdown",
            ext: ".md",
            sourceHash: HASH.source,
          },
          conversion: { mirrorHash: HASH.mirror },
          egressLineage: mixedLineage,
          [SEARCH_RESULT_PLANNER_METADATA]: {
            retrievalRank: 1,
            mirrorHash: HASH.mirror,
            seq: 0,
            sources: ["bm25"],
            graphExpanded: false,
            startLine: 1,
            endLine: 1,
            passageHash: HASH.passage,
          },
        },
      ],
      meta: {
        query: "shared decision",
        mode: "hybrid",
        vectorsUsed: false,
        reranked: false,
        totalResults: 1,
      },
    };
    expect((await started.value.recordRetrieval(results)).ok).toBe(true);
    const widened = await adapter.getRetrievalTrace("trace-egress-selected");
    expect(widened.ok && widened.value?.trace.egressLineage).toEqual(
      mixedLineage
    );
  });

  test("uses all configured collections only for an unfiltered corpus trace", async () => {
    const started = await RetrievalTraceSession.start({
      store: adapter,
      config,
      query: "corpus",
      filters: {},
      fingerprints: () => ({
        pipeline: HASH.pipeline,
        model: HASH.model,
        config: HASH.config,
        index: HASH.index,
      }),
      idFactory: () => "trace-egress-all",
      clock: () => 2_000,
    });
    expect(started.ok).toBe(true);
    const stored = await adapter.getRetrievalTrace("trace-egress-all");
    expect(stored.ok && stored.value?.trace.egressLineage.sources).toEqual([
      { collection: "local", policy: "local_only", source: "explicit" },
      { collection: "remote", policy: "remote", source: "explicit" },
    ]);
  });
});
