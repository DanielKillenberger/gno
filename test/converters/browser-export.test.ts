import { describe, expect, test } from "bun:test";

import type { RecordAdapterInput } from "../../src/converters/types";

import { browserExportAdapter } from "../../src/converters/adapters/browser-export/adapter";
import { runRecordAdapter } from "../../src/ingestion/record-adapter";

const fixtureDir = `${import.meta.dir}/../fixtures/exports/browser`;

const input = (
  source: string,
  options: {
    mime?: string;
    sourcePath?: string;
    relativePath?: string;
    maxRecords?: number;
  } = {}
): RecordAdapterInput => ({
  sourcePath: options.sourcePath ?? `${fixtureDir}/export.browser-export`,
  relativePath: options.relativePath ?? "browser/export.browser-export",
  collection: "browser",
  mime: options.mime ?? "application/x-gno-browser-export+json",
  ext: ".browser-export",
  open: async function* () {
    const bytes = new TextEncoder().encode(source);
    for (let offset = 0; offset < bytes.length; offset += 5) {
      yield bytes.slice(offset, offset + 5);
    }
  },
  limits: {
    maxSourceBytes: 1_000_000,
    maxRecordChars: 100_000,
    maxMetadataChars: 100_000,
    maxTotalChars: 1_000_000,
    maxRecords: options.maxRecords ?? 1_000,
    maxFailures: 100,
  },
});

describe("explicit browser export adapter", () => {
  test("converts Netscape bookmarks with folder, tags, dates, and provenance", async () => {
    const source = await Bun.file(`${fixtureDir}/bookmarks.html`).text();
    const result = await runRecordAdapter(
      browserExportAdapter,
      input(source, { mime: "text/x-gno-browser-bookmarks+html" })
    );

    expect(result.authoritative).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.markdown).toContain("Example &amp; Report");
    expect(result.records[0]?.markdown).toContain("https://example.com/report");
    expect(result.records[0]?.markdown).not.toContain("#section");
    expect(result.records[0]?.markdown).toContain("Folder: Research");
    expect(result.records[0]?.metadata?.categories).toEqual([
      "browser-export",
      "bookmark",
      "work",
      "reading",
    ]);
    expect(result.records[0]?.metadata?.dateFields?.added).toMatch(/Z$/);
    expect(result.records[0]?.sourceLocator).toBe("bookmark:1");
  });

  test("converts closed Chrome-style JSON without recursive discovery", async () => {
    const source = await Bun.file(`${fixtureDir}/chrome-bookmarks.json`).text();
    const result = await runRecordAdapter(browserExportAdapter, input(source));

    expect(result.authoritative).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.stableId).toBe("browser:bookmark:id:42");
    expect(result.records[0]?.markdown).toContain("Folder: Bookmarks bar");
    expect(result.records[0]?.markdown).toContain("https://gno.sh/docs");
    expect(result.records[0]?.sourceLocator).toBe(
      "json/roots/bookmark_bar/children/0"
    );
    expect(result.records[0]?.metadata?.dateFields?.added).toMatch(/^2024-/);
  });

  test("supports history and reading-list records with stable export IDs", async () => {
    const source = JSON.stringify({
      items: [
        {
          id: "history-1",
          kind: "history",
          url: "https://example.com/visited",
          title: "Visited",
          visited_at: "2026-07-22T10:00:00Z",
        },
        {
          id: "read-1",
          kind: "reading-list",
          url: "https://example.com/read",
          title: "Read later",
          read_at: "2026-07-23T10:00:00Z",
        },
      ],
    });
    const first = await runRecordAdapter(browserExportAdapter, input(source));
    const edited = await runRecordAdapter(
      browserExportAdapter,
      input(source.replace("/visited", "/visited-updated"))
    );

    expect(first.records.map((record) => record.stableId).sort()).toEqual([
      "browser:history:id:history-1",
      "browser:reading-list:id:read-1",
    ]);
    const history = first.records.find((record) =>
      record.stableId.includes("history-1")
    );
    const editedHistory = edited.records.find((record) =>
      record.stableId.includes("history-1")
    );
    expect(history?.recordKey).toBe(editedHistory?.recordKey);
    expect(history?.sourceHash).not.toBe(editedHistory?.sourceHash);
  });

  test("isolates dangerous schemes and embedded executable HTML", async () => {
    const source = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><A HREF="https://safe.example/"><script>run()</script>Safe</A>
      <DT><A HREF="javascript:alert(1)">Unsafe</A>
      <DT><A HREF="file:///private/secret">Local file</A>
    </DL><p>`;
    const result = await runRecordAdapter(
      browserExportAdapter,
      input(source, { mime: "text/x-gno-browser-bookmarks+html" })
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.markdown).not.toContain("<script>");
    expect(result.records[0]?.markdown).not.toContain("run()");
    expect(result.failures).toHaveLength(2);
    expect(result.authoritative).toBe(false);
  });

  test("denies live profiles and browser databases before reading", async () => {
    let opened = false;
    const result = await runRecordAdapter(browserExportAdapter, {
      ...input("{}", {
        sourcePath:
          "/Users/test/Library/Application Support/Google/Chrome/User Data/Default/History",
      }),
      open: async function* () {
        opened = true;
        yield new TextEncoder().encode("secret");
      },
    });

    expect(opened).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.authoritative).toBe(false);
    expect(result.failures[0]?.code).toBe("ADAPTER_FAILURE");
  });

  test("denies Linux and macOS Chrome bookmark profile files", async () => {
    for (const sourcePath of [
      "/home/test/.config/google-chrome/Default/Bookmarks",
      "/Users/test/Library/Application Support/Google/Chrome/Default/Bookmarks",
    ]) {
      let opened = false;
      const result = await runRecordAdapter(browserExportAdapter, {
        ...input("{}", { sourcePath }),
        open: async function* () {
          opened = true;
          yield new TextEncoder().encode("secret");
        },
      });
      expect(opened).toBe(false);
      expect(result.authoritative).toBe(false);
    }
  });

  test("rejects sensitive/unknown JSON and credential-bearing URLs", async () => {
    const sensitive = await runRecordAdapter(
      browserExportAdapter,
      input(JSON.stringify({ cookies: [{ name: "session", value: "secret" }] }))
    );
    const unknown = await runRecordAdapter(
      browserExportAdapter,
      input(JSON.stringify({ arbitrary: [] }))
    );
    const credentials = await runRecordAdapter(
      browserExportAdapter,
      input(
        JSON.stringify({
          items: [
            {
              url: "https://user:password@example.com/private",
              title: "secret",
            },
          ],
        })
      )
    );

    for (const result of [sensitive, unknown, credentials]) {
      expect(result.authoritative).toBe(false);
      expect(result.records).toEqual([]);
    }
    expect(JSON.stringify(credentials)).not.toContain("password");
  });

  test("rejects case-variant sensitive JSON and invalid child shapes", async () => {
    for (const source of [
      JSON.stringify({ Cookies: [{ name: "session", value: "secret" }] }),
      JSON.stringify({ history: "not-an-array" }),
      JSON.stringify({
        items: [
          {
            url: "https://example.com",
            Cookies: [{ name: "session", value: "secret" }],
          },
        ],
      }),
    ]) {
      const result = await runRecordAdapter(
        browserExportAdapter,
        input(source)
      );
      expect(result.records).toEqual([]);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.authoritative).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  test("rejects truncated or non-export bookmark HTML", async () => {
    for (const source of [
      "<DL><p>truncated",
      "<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>truncated",
      "<html><body><DL></DL></body></html>",
    ]) {
      const result = await runRecordAdapter(
        browserExportAdapter,
        input(source, { mime: "text/x-gno-browser-bookmarks+html" })
      );
      expect(result.records).toEqual([]);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.authoritative).toBe(false);
    }
  });

  test("bounds record count and treats malformed JSON as partial", async () => {
    const bounded = await runRecordAdapter(
      browserExportAdapter,
      input(
        JSON.stringify({
          items: [
            { url: "https://one.example" },
            { url: "https://two.example" },
          ],
        }),
        { maxRecords: 1 }
      )
    );
    const malformed = await runRecordAdapter(
      browserExportAdapter,
      input("{not json")
    );

    expect(bounded.records).toHaveLength(1);
    expect(bounded.authoritative).toBe(false);
    expect(bounded.failures).toHaveLength(1);
    expect(malformed.records).toEqual([]);
    expect(malformed.authoritative).toBe(false);
  });

  test("requires explicit export MIME or extension", () => {
    expect(
      browserExportAdapter.canHandle(
        "application/x-gno-browser-export+json",
        ".json"
      )
    ).toBe(true);
    expect(browserExportAdapter.canHandle("text/html", ".html")).toBe(false);
    expect(browserExportAdapter.canHandle("application/json", ".json")).toBe(
      false
    );
  });
});
