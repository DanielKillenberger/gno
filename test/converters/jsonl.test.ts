import { describe, expect, test } from "bun:test";

import type {
  RecordAdapterInput,
  RecordAdapterLimits,
} from "../../src/converters/types";

import {
  createJsonlAdapter,
  jsonlAdapter,
} from "../../src/converters/adapters/jsonl/adapter";
import { JsonlFieldMappingSchema } from "../../src/converters/adapters/jsonl/config";
import { runRecordAdapter } from "../../src/ingestion/record-adapter";

const LIMITS: RecordAdapterLimits = {
  maxSourceBytes: 1_000_000,
  maxRecordChars: 100_000,
  maxMetadataChars: 10_000,
  maxTotalChars: 1_000_000,
  maxRecords: 100,
  maxFailures: 20,
};

const chunked = (
  bytes: Uint8Array,
  chunkSize: number,
  onClose?: () => void
): (() => AsyncIterable<Uint8Array>) =>
  async function* () {
    try {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.slice(offset, offset + chunkSize);
      }
    } finally {
      onClose?.();
    }
  };

const input = (
  bytes: Uint8Array,
  overrides: Partial<RecordAdapterInput> = {},
  chunkSize = bytes.byteLength || 1
): RecordAdapterInput => ({
  sourcePath: "/private/export/data.jsonl",
  relativePath: "exports/data.jsonl",
  collection: "notes",
  mime: "application/x-ndjson",
  ext: ".jsonl",
  open: chunked(bytes, chunkSize),
  limits: LIMITS,
  ...overrides,
});

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(
    await Bun.file(
      new URL(`../fixtures/exports/jsonl/${name}`, import.meta.url)
    ).arrayBuffer()
  );

const mapping = {
  id: "/id",
  body: "/text",
  title: "/meta/title",
  author: "/author",
  participants: "/people",
  categories: "/labels",
  dateFields: { created: "/dates/created" },
} as const;

describe("JSONL record adapter", () => {
  test("maps deterministic records with exact line provenance", async () => {
    const bytes = await fixture("mapped.jsonl");
    const first = await runRecordAdapter(
      createJsonlAdapter(mapping),
      input(bytes, {}, 7)
    );
    const second = await runRecordAdapter(
      createJsonlAdapter(mapping),
      input(bytes, {}, 29)
    );

    expect(first.authoritative).toBe(true);
    expect(first.records).toHaveLength(2);
    expect(
      first.records.map(({ recordKey, sourceHash, mirrorHash }) => ({
        recordKey,
        sourceHash,
        mirrorHash,
      }))
    ).toEqual(
      second.records.map(({ recordKey, sourceHash, mirrorHash }) => ({
        recordKey,
        sourceHash,
        mirrorHash,
      }))
    );
    const launch = first.records.find(
      (record) => record.title === "Launch / Plan"
    );
    expect(launch?.sourceLocator).toBe("line:1");
    expect(launch?.metadata).toMatchObject({
      author: "Ada",
      participants: ["Ada", "Lin"],
      categories: ["decision", "search"],
      dateFields: { created: "2026-07-24" },
    });
    expect(launch?.anchors).toEqual([{ kind: "line", value: "1" }]);
    expect(launch?.markdown).toContain("Ship the multilingual index.");
  });

  test("isolates a malformed middle line without tombstone authority", async () => {
    const result = await runRecordAdapter(
      jsonlAdapter,
      input(await fixture("malformed.jsonl"), {}, 3)
    );

    expect(result.records).toHaveLength(2);
    expect(result.failures.map((failure) => failure.code)).toContain(
      "MALFORMED_RECORD"
    );
    expect(result.failures[0]?.sourceLocator).toBe("line:2");
    expect(result.snapshotState).toBe("partial");
    expect(result.authoritative).toBe(false);
  });

  test("configured IDs update in place while append identity follows content", async () => {
    const firstBytes = new TextEncoder().encode(
      '{"id":"same","text":"before"}\n'
    );
    const secondBytes = new TextEncoder().encode(
      '{"id":"same","text":"after"}\n'
    );
    const configured = createJsonlAdapter({ id: "/id", body: "/text" });
    const first = await runRecordAdapter(configured, input(firstBytes));
    const second = await runRecordAdapter(configured, input(secondBytes));
    expect(first.records[0]?.recordKey).toBe(second.records[0]?.recordKey);
    expect(first.records[0]?.sourceHash).not.toBe(
      second.records[0]?.sourceHash
    );

    const appendOnly = createJsonlAdapter({ body: "/text" });
    const appendFirst = await runRecordAdapter(appendOnly, input(firstBytes));
    const appendSecond = await runRecordAdapter(appendOnly, input(secondBytes));
    expect(appendFirst.records[0]?.recordKey).not.toBe(
      appendSecond.records[0]?.recordKey
    );
  });

  test("requires an ID when an explicit selector is configured", async () => {
    const result = await runRecordAdapter(
      createJsonlAdapter({ id: "/missing", body: "/text" }),
      input(new TextEncoder().encode('{"text":"body"}\n'))
    );
    expect(result.records).toEqual([]);
    expect(result.failures[0]?.code).toBe("MISSING_ID");
    expect(result.authoritative).toBe(false);
  });

  test("treats an empty error-free export as an authoritative snapshot", async () => {
    const result = await runRecordAdapter(
      createJsonlAdapter({ id: "/id", body: "/text" }),
      input(new TextEncoder().encode("\n\n"))
    );
    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.snapshotState).toBe("complete");
    expect(result.authoritative).toBe(true);
  });

  test("isolates invalid UTF-8 and oversized lines then resumes", async () => {
    const invalid = new Uint8Array([
      0xff,
      0x0a,
      ...new TextEncoder().encode('{"id":"valid","text":"ok"}\n'),
    ]);
    const invalidResult = await runRecordAdapter(
      jsonlAdapter,
      input(invalid, {}, 2)
    );
    expect(invalidResult.records).toHaveLength(1);
    expect(invalidResult.failures[0]?.sourceLocator).toBe("line:1");

    const oversized = new TextEncoder().encode(
      `${JSON.stringify({ id: "huge", text: "x".repeat(6_000) })}\n{"id":"valid","text":"ok"}\n`
    );
    const oversizedResult = await runRecordAdapter(
      jsonlAdapter,
      input(oversized, {
        limits: {
          ...LIMITS,
          maxRecordChars: 50,
          maxMetadataChars: 1_000,
        },
      })
    );
    expect(oversizedResult.records).toHaveLength(1);
    expect(oversizedResult.failures[0]?.code).toBe("RECORD_TOO_LARGE");
    expect(oversizedResult.failures[0]?.sourceLocator).toBe("line:1");
  });

  test("validates mappings without executable or prototype paths", () => {
    expect(
      JsonlFieldMappingSchema.safeParse({
        body: ["/payload/text", "/fallback"],
        title: "/meta/a~1b",
      }).success
    ).toBe(true);
    expect(
      JsonlFieldMappingSchema.safeParse({ body: "/__proto__/secret" }).success
    ).toBe(false);
    expect(
      JsonlFieldMappingSchema.safeParse({ body: "payload.text" }).success
    ).toBe(false);
    expect(
      JsonlFieldMappingSchema.safeParse({
        body: "/text",
        expression: "process.exit()",
      }).success
    ).toBe(false);
  });

  test("closes the source when the central record cap stops consumption", async () => {
    let closed = false;
    const bytes = new TextEncoder().encode(
      '{"id":"one","text":"one"}\n{"id":"two","text":"two"}\n'
    );
    const result = await runRecordAdapter(
      jsonlAdapter,
      input(bytes, {
        open: chunked(bytes, 4, () => {
          closed = true;
        }),
        limits: { ...LIMITS, maxRecords: 1 },
      })
    );
    expect(result.stoppedByCap).toBe(true);
    expect(closed).toBe(true);
  });

  test("does not leak source paths or malformed data in failures", async () => {
    const privateValue = "/Users/private/secret";
    const result = await runRecordAdapter(
      jsonlAdapter,
      input(new TextEncoder().encode(`{"id":"${privateValue}"\n`))
    );
    expect(JSON.stringify(result.failures)).not.toContain(privateValue);
    expect(JSON.stringify(result.failures)).not.toContain("/private/export");
  });
});
