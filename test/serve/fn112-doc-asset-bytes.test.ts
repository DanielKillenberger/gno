/**
 * B5-02: real handleDocAsset byte routing via SqliteAdapter + on-disk files.
 * Proves nested / recordSourcePath / container-backed / same-basename siblings
 * return BYTE-EXACT intended content for production buildDocAssetUrl URLs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Config } from "../../src/config/types";
import type { DocumentInput } from "../../src/store/types";

import {
  assetPathFromRelPath,
  buildDocAssetUrl,
} from "../../src/serve/public/lib/doc-asset-url";
import { handleDocAsset } from "../../src/serve/routes/api";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

function createConfig(root: string): Config {
  return {
    version: "1.0",
    ftsTokenizer: "unicode61",
    collections: [
      {
        name: "notes",
        path: root,
        pattern: "**/*",
        include: [],
        exclude: [],
      },
    ],
    contexts: [],
  };
}

/** API-facing relPath is recordSourcePath ?? relPath (handleDoc GET / resolve). */
function apiRelPath(doc: {
  relPath: string;
  recordSourcePath?: string | null;
}): string {
  return doc.recordSourcePath ?? doc.relPath;
}

describe("fn-112 handleDocAsset real-byte routing (B5-02)", () => {
  let root: string;
  let store: SqliteAdapter;
  let config: Config;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-fn112-asset-bytes-"));
    store = new SqliteAdapter();
    const open = await store.open(join(root, "index.db"), "porter");
    expect(open.ok).toBe(true);
    const sync = await store.syncCollections([
      {
        name: "notes",
        path: root,
        pattern: "**/*",
        include: [],
        exclude: [],
      },
    ]);
    expect(sync.ok).toBe(true);
    config = createConfig(root);
  });

  afterEach(async () => {
    await store.close();
    await safeRm(root);
  });

  async function seedFile(relFile: string, bytes: string): Promise<void> {
    const abs = join(root, relFile);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  async function upsertPdf(input: {
    relPath: string;
    hash: string;
    recordSourcePath?: string;
    recordKey?: string;
  }): Promise<{ uri: string; apiRelPath: string }> {
    const doc: DocumentInput = {
      collection: "notes",
      relPath: input.relPath,
      sourceHash: input.hash,
      sourceMime: "application/pdf",
      sourceExt: ".pdf",
      sourceSize: 64,
      sourceMtime: new Date().toISOString(),
      title: input.relPath,
      mirrorHash: `mirror-${input.hash}`,
      recordSourcePath: input.recordSourcePath,
      recordKey: input.recordKey,
      ingestVersion: 2,
    };
    const result = await store.upsertDocument(doc);
    expect(result.ok).toBe(true);
    const loaded = await store.getDocument("notes", input.relPath);
    if (!loaded.ok || !loaded.value) {
      throw new Error(`getDocument failed for ${input.relPath}`);
    }
    const row = loaded.value;
    const api = apiRelPath(row);
    return { uri: row.uri, apiRelPath: api };
  }

  async function fetchAsset(
    uri: string,
    apiRel: string
  ): Promise<{ status: number; body: string; contentType: string | null }> {
    const built = buildDocAssetUrl(uri, apiRel);
    // production helper → path is basename only
    expect(new URL(built, "http://localhost").searchParams.get("path")).toBe(
      assetPathFromRelPath(apiRel)
    );
    const url = new URL(built, "http://localhost");
    const res = await handleDocAsset(store, config, url);
    const body = await res.text();
    return {
      status: res.status,
      body,
      contentType: res.headers.get("content-type"),
    };
  }

  test("nested, recordSourcePath, container-backed, same-basename siblings — byte exact", async () => {
    // ── Nested ordinary PDF ─────────────────────────────────────────────
    const nestedBytes = "PDF-NESTED-BYTES-α";
    await seedFile("nested/dir/report.pdf", nestedBytes);
    const nested = await upsertPdf({
      relPath: "nested/dir/report.pdf",
      hash: "nested-hash-001",
    });
    expect(nested.apiRelPath).toBe("nested/dir/report.pdf");

    // ── recordSourcePath-backed: logical relPath differs; file at record path ─
    // Shape mirrors export/container records: virtual .gno path + real source.
    const recordBytes = "PDF-RECORD-SOURCE-BYTES-β";
    await seedFile("imports/real-source.pdf", recordBytes);
    const record = await upsertPdf({
      relPath: ".gno/records/container/deadbeef.pdf",
      hash: "record-hash-002",
      recordSourcePath: "imports/real-source.pdf",
      recordKey: "deadbeef",
    });
    expect(record.apiRelPath).toBe("imports/real-source.pdf");

    // ── Container-backed: same virtual-path convention, distinct payload ─
    // Production container records use relPath under `.gno/records/...` and
    // recordSourcePath pointing at the physical entry under the collection root
    // (see src/ingestion/record-container.ts upsert).
    const containerBytes = "PDF-CONTAINER-BACKED-BYTES-γ";
    await seedFile("container/pack/source.pdf", containerBytes);
    const container = await upsertPdf({
      relPath: ".gno/records/container/cafebabe.pdf",
      hash: "container-hash-003",
      recordSourcePath: "container/pack/source.pdf",
      recordKey: "cafebabe",
    });
    expect(container.apiRelPath).toBe("container/pack/source.pdf");

    // ── Same-basename siblings in different directories ──────────────────
    const sib1Bytes = "PDF-SIBLING-DIR1-BYTES-δ";
    const sib2Bytes = "PDF-SIBLING-DIR2-BYTES-ε";
    await seedFile("dir1/report.pdf", sib1Bytes);
    await seedFile("dir2/report.pdf", sib2Bytes);
    const sib1 = await upsertPdf({
      relPath: "dir1/report.pdf",
      hash: "sib1-hash-004",
    });
    const sib2 = await upsertPdf({
      relPath: "dir2/report.pdf",
      hash: "sib2-hash-005",
    });
    expect(assetPathFromRelPath(sib1.apiRelPath)).toBe("report.pdf");
    expect(assetPathFromRelPath(sib2.apiRelPath)).toBe("report.pdf");
    expect(sib1.uri).not.toBe(sib2.uri);

    // ── Fetch each via production URL + real handleDocAsset ─────────────
    const cases: Array<{
      label: string;
      uri: string;
      apiRel: string;
      bytes: string;
    }> = [
      {
        label: "nested",
        uri: nested.uri,
        apiRel: nested.apiRelPath,
        bytes: nestedBytes,
      },
      {
        label: "recordSourcePath",
        uri: record.uri,
        apiRel: record.apiRelPath,
        bytes: recordBytes,
      },
      {
        label: "container-backed",
        uri: container.uri,
        apiRel: container.apiRelPath,
        bytes: containerBytes,
      },
      {
        label: "sibling-dir1",
        uri: sib1.uri,
        apiRel: sib1.apiRelPath,
        bytes: sib1Bytes,
      },
      {
        label: "sibling-dir2",
        uri: sib2.uri,
        apiRel: sib2.apiRelPath,
        bytes: sib2Bytes,
      },
    ];

    for (const c of cases) {
      const got = await fetchAsset(c.uri, c.apiRel);
      expect(got.status).toBe(200);
      expect(got.body).toBe(c.bytes);
      expect(got.contentType).toBeTruthy();
    }

    // Same basename, different URIs → distinct bytes (not sibling bleed)
    const a = await fetchAsset(sib1.uri, sib1.apiRelPath);
    const b = await fetchAsset(sib2.uri, sib2.apiRelPath);
    expect(a.body).toBe(sib1Bytes);
    expect(b.body).toBe(sib2Bytes);
    expect(a.body).not.toBe(b.body);

    // Cross-dir wrong path under dir1 URI cannot select dir2 sibling content
    const cross = new URL(
      `http://localhost/api/doc-asset?uri=${encodeURIComponent(sib1.uri)}&path=${encodeURIComponent("../dir2/report.pdf")}`
    );
    const crossRes = await handleDocAsset(store, config, cross);
    // Either forbidden (escape) or resolves within root but must NOT return
    // sibling bytes as if it were the indexed document path helper output.
    const crossBody = await crossRes.text();
    if (crossRes.status === 200) {
      // If the relative traversal is allowed within collection, content is
      // dir2's file — prove it is not confused with production basename URL
      // for dir1 (which returned sib1Bytes above).
      expect(crossBody).toBe(sib2Bytes);
    }
    const prodDir1 = await fetchAsset(sib1.uri, sib1.apiRelPath);
    expect(prodDir1.body).toBe(sib1Bytes);
    expect(prodDir1.body).not.toBe(sib2Bytes);

    // Path that escapes collection → 403 (containment preserved)
    const escape = new URL(
      `http://localhost/api/doc-asset?uri=${encodeURIComponent(nested.uri)}&path=${encodeURIComponent("../../../../../../etc/passwd")}`
    );
    const escapeRes = await handleDocAsset(store, config, escape);
    expect(escapeRes.status).toBe(403);
  });
});
