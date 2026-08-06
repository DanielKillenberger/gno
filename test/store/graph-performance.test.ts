import { expect, test } from "bun:test";

import { SqliteAdapter } from "../../src/store/sqlite/adapter";

const DOCUMENT_COUNT = 250;
const LINK_COUNT = 750;
const GRAPH_STALL_REGRESSION_BUDGET_MS = 1500;

test("getGraph resolves a moderate link inventory without starving timers", async () => {
  const adapter = new SqliteAdapter();
  const opened = await adapter.open(":memory:", "porter");
  expect(opened.ok).toBe(true);
  const collections = await adapter.syncCollections([
    {
      name: "notes",
      path: "/tmp",
      pattern: "**/*.md",
      include: [],
      exclude: [],
    },
  ]);
  expect(collections.ok).toBe(true);

  try {
    const db = adapter.getRawDb();
    const insertDocument = db.prepare(`
      INSERT INTO documents (
        collection, rel_path, source_hash, source_mime, source_ext,
        source_size, source_mtime, docid, uri, title
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (let index = 0; index < DOCUMENT_COUNT; index += 1) {
        const name = `doc-${index}`;
        insertDocument.run(
          "notes",
          `${name}.md`,
          `hash-${index}`,
          "text/markdown",
          ".md",
          100,
          "2026-08-06T00:00:00Z",
          `#${index.toString(16).padStart(8, "0")}`,
          `gno://notes/${name}.md`,
          name
        );
      }
    })();

    const insertLink = db.prepare(`
      INSERT INTO doc_links (
        source_doc_id, link_type, target_ref, target_ref_norm,
        start_line, start_col, end_line, end_col
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (let index = 0; index < LINK_COUNT; index += 1) {
        const sourceId = (index % DOCUMENT_COUNT) + 1;
        const target = `doc-${(index * 17 + 1) % DOCUMENT_COUNT}`;
        insertLink.run(
          sourceId,
          "wiki",
          target,
          target,
          index + 1,
          1,
          index + 1,
          10
        );
      }
    })();

    let timerDelayMs = 0;
    const timerStartedAt = performance.now();
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerDelayMs = performance.now() - timerStartedAt;
        resolve();
      }, 10);
    });
    const graphStartedAt = performance.now();
    const graph = await adapter.getGraph({
      collection: "notes",
      limitNodes: DOCUMENT_COUNT,
      limitEdges: LINK_COUNT,
    });
    const graphDurationMs = performance.now() - graphStartedAt;
    await timer;

    expect(graph.ok).toBe(true);
    if (!graph.ok) return;
    expect(graph.value.links).toHaveLength(DOCUMENT_COUNT);
    expect(graph.value.links.every(({ weight }) => weight === 3)).toBe(true);
    expect(graph.value.report.unresolvedLinks.total).toBe(0);
    expect(graphDurationMs).toBeLessThan(GRAPH_STALL_REGRESSION_BUDGET_MS);
    expect(timerDelayMs).toBeLessThan(GRAPH_STALL_REGRESSION_BUDGET_MS);
  } finally {
    await adapter.close();
  }
});
