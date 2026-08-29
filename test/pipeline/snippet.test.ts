/**
 * Display-snippet cleaning: strip leading YAML frontmatter, keep prose.
 *
 * @module test/pipeline/snippet
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChunkInput } from "../../src/store/types";

import { searchBm25 } from "../../src/pipeline/search";
import {
  cleanDisplaySnippet,
  isFrontmatterDominatedSnippet,
} from "../../src/pipeline/snippet";
import { SqliteAdapter } from "../../src/store";
import { safeRm } from "../helpers/cleanup";

const FRONTMATTERED_BODY = `# Vault agent notes

The agent keeps skills portable across machines without leaking vault
credentials into search snippets.`;

const FRONTMATTERED_DOC = `---
tags:
  - homelab
  - fn121probesnippet
---

${FRONTMATTERED_BODY}
`;

describe("cleanDisplaySnippet", () => {
  test("strips a leading fenced YAML frontmatter block", () => {
    const cleaned = cleanDisplaySnippet(FRONTMATTERED_DOC, FRONTMATTERED_DOC);
    expect(cleaned.text).toBe(`${FRONTMATTERED_BODY}\n`);
    expect(cleaned.text.startsWith("---")).toBe(false);
    expect(cleaned.startLineOffset).toBe(6);
    expect(cleaned.usedChunkFallback).toBe(false);
  });

  test("leaves text without frontmatter unchanged", () => {
    const prose = "# Heading\n\nJust content.";
    const cleaned = cleanDisplaySnippet(prose, prose);
    expect(cleaned).toEqual({
      text: prose,
      startLineOffset: 0,
      usedChunkFallback: false,
    });
  });

  test("keeps the original text when the document is only frontmatter", () => {
    const onlyFence = `---
tags:
  - homelab
---
`;
    const cleaned = cleanDisplaySnippet(onlyFence, onlyFence);
    expect(cleaned.text).toBe(onlyFence);
    expect(cleaned.startLineOffset).toBe(0);
    expect(cleaned.usedChunkFallback).toBe(false);
  });

  test("trims blank lines after the closing fence", () => {
    const source = `---
title: Test
---


# Heading`;
    const cleaned = cleanDisplaySnippet(source, source);
    expect(cleaned.text).toBe("# Heading");
    expect(cleaned.startLineOffset).toBe(5);
  });

  test("falls back to stripped chunk prose for a mark-containing FTS snippet", () => {
    const ftsSnippet = `---
tags:
  - <mark>homelab</mark>
...`;
    expect(isFrontmatterDominatedSnippet(ftsSnippet)).toBe(true);

    const cleaned = cleanDisplaySnippet(ftsSnippet, FRONTMATTERED_DOC);
    expect(cleaned.usedChunkFallback).toBe(true);
    expect(cleaned.text).toBe(`${FRONTMATTERED_BODY}\n`);
    expect(cleaned.text.startsWith("---")).toBe(false);
    expect(cleaned.startLineOffset).toBe(6);
  });

  test("keeps FTS-highlighted prose after a straddling closing fence", () => {
    const ftsSnippet = `...discovery checks 2026-08-27
  - <mark>vault</mark>-<mark>agent</mark>-sync deployment receipts 2026-08-27
---

# <mark>Vault</mark> <mark>Agent</mark> <mark>Skills</mark> and MCP <mark>Portability</mark> Runbook

Canonical operating model for making GordonsVault <mark>skills</mark> available to Claude Code, Codex...`;
    const cleaned = cleanDisplaySnippet(ftsSnippet, FRONTMATTERED_DOC);
    expect(cleaned.text.startsWith("---")).toBe(false);
    expect(cleaned.text.startsWith("# <mark>Vault</mark>")).toBe(true);
    expect(cleaned.text).toContain("Canonical operating model");
    expect(cleaned.startLineOffset).toBe(6);
    expect(cleaned.usedChunkFallback).toBe(false);
  });

  test("does not treat a thematic-break --- in prose as frontmatter", () => {
    const prose = `Skills stay portable.

---

Next section about vault agents.`;
    const cleaned = cleanDisplaySnippet(prose, prose);
    expect(cleaned.text).toBe(prose);
    expect(cleaned.startLineOffset).toBe(0);
  });

  test("bumps startLine when an FTS snippet includes a complete leading fence", () => {
    const ftsSnippet = `---
tags:
  - <mark>homelab</mark>
---
# Vault <mark>agent</mark> notes`;
    const cleaned = cleanDisplaySnippet(ftsSnippet, FRONTMATTERED_DOC);
    expect(cleaned.usedChunkFallback).toBe(false);
    expect(cleaned.text).toBe("# Vault <mark>agent</mark> notes");
    expect(cleaned.startLineOffset).toBe(4);
  });
});

describe("searchBm25 snippets skip frontmatter", () => {
  let adapter: SqliteAdapter;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "gno-snippet-quality-"));
    adapter = new SqliteAdapter();
    const opened = await adapter.open(
      join(testDir, "test.sqlite"),
      "unicode61"
    );
    expect(opened.ok).toBe(true);
    await adapter.syncCollections([
      {
        name: "test",
        path: testDir,
        pattern: "**/*.md",
        include: [],
        exclude: [],
      },
    ]);

    const sourceHash = Bun.hash(FRONTMATTERED_DOC).toString(16);
    const chunks: ChunkInput[] = [
      {
        seq: 0,
        pos: 0,
        text: FRONTMATTERED_DOC,
        startLine: 1,
        endLine: FRONTMATTERED_DOC.split("\n").length,
        tokenCount: Math.ceil(FRONTMATTERED_DOC.length / 4),
      },
    ];

    await adapter.upsertDocument({
      sourceHash,
      collection: "test",
      relPath: "vault-agent.md",
      sourceMime: "text/markdown",
      sourceExt: ".md",
      sourceMtime: new Date().toISOString(),
      sourceSize: FRONTMATTERED_DOC.length,
      mirrorHash: sourceHash,
      title: "Vault agent notes",
    });
    await adapter.upsertContent(sourceHash, FRONTMATTERED_DOC);
    await adapter.syncDocumentFts("test", "vault-agent.md");
    await adapter.upsertChunks(sourceHash, chunks);
  });

  afterEach(async () => {
    await adapter.close();
    await safeRm(testDir);
  });

  test("tag-matching BM25 snippet starts with prose, not a --- fence", async () => {
    const result = await searchBm25(adapter, "fn121probesnippet");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.results.length).toBeGreaterThan(0);
    const hit = result.value.results[0];
    expect(hit).toBeDefined();
    if (!hit) {
      return;
    }

    expect(hit.snippet.startsWith("---")).toBe(false);
    expect(hit.snippet).toContain("portable");
    expect(hit.snippet).toContain("Vault agent notes");
    expect(hit.line).toBeGreaterThan(1);
    expect(hit.snippetRange?.startLine).toBe(hit.line);
  });

  test("does not strip frontmatter from --full output", async () => {
    const result = await searchBm25(adapter, "fn121probesnippet", {
      full: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const hit = result.value.results[0];
    expect(hit?.snippet.startsWith("---")).toBe(true);
    expect(hit?.snippet).toContain("fn121probesnippet");
    expect(hit?.snippetRange).toBeUndefined();
  });

  test("does not strip frontmatter from --line-numbers output", async () => {
    const result = await searchBm25(adapter, "fn121probesnippet", {
      lineNumbers: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const hit = result.value.results[0];
    expect(hit?.snippet.startsWith("---")).toBe(true);
    expect(hit?.line).toBe(1);
    expect(hit?.snippetRange?.startLine).toBe(1);
  });
});
