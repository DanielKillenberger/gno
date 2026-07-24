import { describe, expect, test } from "bun:test";

import type {
  RecordAdapterInput,
  RecordAdapterLimits,
} from "../../src/converters/types";

import {
  createTranscriptAdapter,
  transcriptAdapter,
} from "../../src/converters/adapters/transcript/adapter";
import { runRecordAdapter } from "../../src/ingestion/record-adapter";

const LIMITS: RecordAdapterLimits = {
  maxSourceBytes: 1_000_000,
  maxRecordChars: 100_000,
  maxMetadataChars: 10_000,
  maxTotalChars: 1_000_000,
  maxRecords: 100,
  maxFailures: 20,
};

const input = (
  bytes: Uint8Array,
  format: { ext: string; mime: string },
  chunkSize = bytes.byteLength || 1,
  overrides: Partial<RecordAdapterInput> = {}
): RecordAdapterInput => ({
  sourcePath: `/private/export/session${format.ext}`,
  relativePath: `transcripts/session${format.ext}`,
  collection: "meetings",
  mime: format.mime,
  ext: format.ext,
  open: async function* () {
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      yield bytes.slice(offset, offset + chunkSize);
    }
  },
  limits: LIMITS,
  ...overrides,
});

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(
    await Bun.file(
      new URL(`../fixtures/exports/transcript/${name}`, import.meta.url)
    ).arrayBuffer()
  );

describe("transcript record adapter", () => {
  test("streams WebVTT cues with speakers, times, and sanitized text", async () => {
    const bytes = await fixture("sample.vtt");
    const result = await runRecordAdapter(
      transcriptAdapter,
      input(bytes, { ext: ".vtt", mime: "text/vtt" }, 5)
    );

    expect(result.authoritative).toBe(true);
    expect(result.records).toHaveLength(2);
    const ada = result.records.find(
      (record) => record.metadata?.author === "Ada"
    );
    expect(ada?.sourceLocator).toBe("lines:6-8");
    expect(ada?.metadata?.categories).toEqual(["transcript"]);
    expect(ada?.anchors).toContainEqual({
      kind: "timestamp",
      value: "00:00:01.000",
      endValue: "00:00:03.500",
    });
    expect(ada?.markdown).toContain("Welcome & hello.");
    const serialized = JSON.stringify(result.records);
    expect(serialized).not.toContain("private production note");
    expect(serialized).not.toContain("alert");
    expect(serialized).not.toContain("<script");
  });

  test("parses SRT multiline cues and preserves numbered identity", async () => {
    const original = await fixture("sample.srt");
    const edited = new TextEncoder().encode(
      new TextDecoder().decode(original).replace("First line", "Changed line")
    );
    const adapter = createTranscriptAdapter({ format: "srt" });
    const first = await runRecordAdapter(
      adapter,
      input(original, { ext: ".srt", mime: "application/x-subrip" }, 4)
    );
    const second = await runRecordAdapter(
      adapter,
      input(edited, { ext: ".srt", mime: "application/x-subrip" }, 17)
    );

    expect(first.authoritative).toBe(true);
    expect(first.records).toHaveLength(2);
    const firstCue = first.records.find(
      (record) => record.metadata?.author === "Ada"
    );
    const editedCue = second.records.find(
      (record) => record.metadata?.author === "Ada"
    );
    expect(firstCue?.markdown).toContain("continues here.");
    expect(firstCue?.recordKey).toBe(editedCue?.recordKey);
    expect(firstCue?.sourceHash).not.toBe(editedCue?.sourceHash);
  });

  test("supports explicit common JSON transcripts with session metadata", async () => {
    const bytes = await fixture("sample.json");
    const result = await runRecordAdapter(
      createTranscriptAdapter({ format: "json" }),
      input(bytes, { ext: ".json", mime: "application/json" }, 11)
    );

    expect(result.authoritative).toBe(true);
    expect(result.records).toHaveLength(2);
    const first = result.records.find(
      (record) => record.metadata?.author === "Ada"
    );
    expect(first?.title).toBe("Agent retrieval review — Ada");
    expect(first?.sourceLocator).toBe("record:segments/0");
    expect(first?.metadata).toMatchObject({
      participants: ["Ada", "Lin"],
      categories: ["transcript"],
      dateFields: { recorded: "2026-07-24T09:00:00Z" },
      sessionId: "session-42",
    });
    expect(first?.anchors).toContainEqual({
      kind: "record",
      value: "/segments/0",
    });
  });

  test("supports explicit text transcripts without claiming generic text", async () => {
    expect(transcriptAdapter.canHandle("text/plain", ".txt")).toBe(false);
    const adapter = createTranscriptAdapter({ format: "text" });
    expect(adapter.canHandle("text/plain", ".txt")).toBe(true);
    const result = await runRecordAdapter(
      adapter,
      input(await fixture("sample.txt"), { ext: ".txt", mime: "text/plain" }, 3)
    );

    expect(result.records).toHaveLength(3);
    const ada = result.records.find(
      (record) => record.metadata?.author === "Ada"
    );
    expect(ada?.sourceLocator).toBe("line:1");
    expect(ada?.anchors).toContainEqual({
      kind: "timestamp",
      value: "00:00:01.000",
      endValue: undefined,
    });
    expect(() =>
      createTranscriptAdapter({
        format: "executable" as never,
      })
    ).toThrow("Unsupported transcript adapter format");
  });

  test("isolates malformed cues and duplicate cue IDs", async () => {
    const malformed = new TextEncoder().encode(
      "WEBVTT\n\none\n00:00:01.000 --> 00:00:02.000\nValid\n\nbad block\nnot timing\nBroken\n\ntwo\n00:00:03.000 --> 00:00:04.000\nAlso valid\n"
    );
    const malformedResult = await runRecordAdapter(
      transcriptAdapter,
      input(malformed, { ext: ".vtt", mime: "text/vtt" }, 2)
    );
    expect(malformedResult.records).toHaveLength(2);
    expect(malformedResult.failures[0]?.code).toBe("MALFORMED_RECORD");
    expect(malformedResult.authoritative).toBe(false);

    const duplicate = new TextEncoder().encode(
      "WEBVTT\n\ndup\n00:00:01.000 --> 00:00:02.000\nFirst\n\ndup\n00:00:03.000 --> 00:00:04.000\nSecond\n"
    );
    const duplicateResult = await runRecordAdapter(
      transcriptAdapter,
      input(duplicate, { ext: ".vtt", mime: "text/vtt" })
    );
    expect(duplicateResult.records).toEqual([]);
    expect(duplicateResult.failures[0]?.code).toBe("DUPLICATE_ID");
  });

  test("rejects invalid timing and isolates invalid UTF-8", async () => {
    const badTime = new TextEncoder().encode(
      "1\n00:00:03,000 --> 00:00:02,000\nBackwards\n\n2\n00:00:04,000 --> 00:00:05,000\nValid\n"
    );
    const timedResult = await runRecordAdapter(
      createTranscriptAdapter({ format: "srt" }),
      input(badTime, { ext: ".srt", mime: "application/x-subrip" })
    );
    expect(timedResult.records).toHaveLength(1);
    expect(timedResult.failures[0]?.sourceLocator).toBe("lines:1-3");

    const invalidUtf8 = new Uint8Array([
      ...new TextEncoder().encode("WEBVTT\n\n"),
      0xff,
      0x0a,
      ...new TextEncoder().encode(
        "\nvalid\n00:00:01.000 --> 00:00:02.000\nWorks\n"
      ),
    ]);
    const utf8Result = await runRecordAdapter(
      transcriptAdapter,
      input(invalidUtf8, { ext: ".vtt", mime: "text/vtt" }, 1)
    );
    expect(utf8Result.records).toHaveLength(1);
    expect(utf8Result.failures[0]?.sourceLocator).toBe("line:3");
  });

  test("is deterministic across source chunk boundaries", async () => {
    const bytes = await fixture("sample.vtt");
    const first = await runRecordAdapter(
      transcriptAdapter,
      input(bytes, { ext: ".vtt", mime: "text/vtt" }, 1)
    );
    const second = await runRecordAdapter(
      transcriptAdapter,
      input(bytes, { ext: ".vtt", mime: "text/vtt" }, 31)
    );
    expect(first.records).toEqual(second.records);
  });

  test("stops and closes source iteration under the central record cap", async () => {
    let closed = false;
    const bytes = await fixture("sample.srt");
    const result = await runRecordAdapter(
      createTranscriptAdapter({ format: "srt" }),
      input(bytes, { ext: ".srt", mime: "application/x-subrip" }, 2, {
        open: async function* () {
          try {
            for (let offset = 0; offset < bytes.byteLength; offset += 2) {
              yield bytes.slice(offset, offset + 2);
            }
          } finally {
            closed = true;
          }
        },
        limits: { ...LIMITS, maxRecords: 1 },
      })
    );
    expect(result.stoppedByCap).toBe(true);
    expect(closed).toBe(true);
  });

  test("treats an unterminated WebVTT header as a partial snapshot", async () => {
    const bytes = new TextEncoder().encode(
      "WEBVTT\ncue\n00:00:01.000 --> 00:00:02.000\nNot a terminated header\n"
    );
    const result = await runRecordAdapter(
      transcriptAdapter,
      input(bytes, { ext: ".vtt", mime: "text/vtt" })
    );

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.code).toBe("MALFORMED_RECORD");
    expect(result.failures[0]?.retryable).toBe(true);
    expect(result.authoritative).toBe(false);
  });

  test("keeps transcript Markdown links and remote images inert", async () => {
    const bytes = new TextEncoder().encode(
      "WEBVTT\n\ncue\n00:00:01.000 --> 00:00:02.000\n![remote](https://example.com/pixel)\n"
    );
    const result = await runRecordAdapter(
      transcriptAdapter,
      input(bytes, { ext: ".vtt", mime: "text/vtt" })
    );

    expect(result.authoritative).toBe(true);
    expect(result.records[0]?.markdown).not.toContain("![remote]");
    expect(result.records[0]?.markdown).toContain("\\!\\[remote\\]");
  });
});
