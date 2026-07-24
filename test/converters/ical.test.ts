import { describe, expect, test } from "bun:test";

import type { RecordAdapterInput } from "../../src/converters/types";

import { icalAdapter } from "../../src/converters/adapters/ical/adapter";
import {
  MAX_RECURRENCE_ANCHORS,
  summarizeRecurrence,
} from "../../src/converters/adapters/ical/recurrence";
import { runRecordAdapter } from "../../src/ingestion/record-adapter";

const fixturePath = `${import.meta.dir}/../fixtures/exports/calendar/sample.ics`;

const input = (
  source: string,
  chunkSize = source.length,
  overrides: Partial<RecordAdapterInput["limits"]> = {}
): RecordAdapterInput => ({
  sourcePath: fixturePath,
  relativePath: "calendar/sample.ics",
  collection: "calendar",
  mime: "text/calendar",
  ext: ".ics",
  open: async function* () {
    const bytes = new TextEncoder().encode(source);
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      yield bytes.slice(offset, offset + chunkSize);
    }
  },
  limits: {
    maxSourceBytes: 1_000_000,
    maxRecordChars: 100_000,
    maxMetadataChars: 100_000,
    maxTotalChars: 1_000_000,
    maxRecords: 1_000,
    maxFailures: 100,
    ...overrides,
  },
});

describe("iCalendar export adapter", () => {
  test("preserves identities, people, dates, provenance, and safe text", async () => {
    const source = await Bun.file(fixturePath).text();
    const result = await runRecordAdapter(icalAdapter, input(source, 7));

    expect(result.authoritative).toBe(true);
    expect(result.records).toHaveLength(2);
    const client = result.records.find((record) =>
      record.stableId.includes("event-1")
    );
    expect(client?.sourceLocator).toMatch(/^lines:\d+-\d+$/);
    expect(client?.metadata?.eventId).toBe("event-1@example.test");
    expect(client?.metadata?.author).toContain("gordon@example.test");
    expect(client?.metadata?.participants).toContain(
      "Alice &lt;alice@example.test&gt;"
    );
    expect(client?.metadata?.dateFields?.start).toBe(
      "TZID=Europe/Zurich:2026-10-25T09:30:00"
    );
    expect(client?.markdown).toContain("&lt;script&gt;");
    expect(client?.markdown).not.toContain("<script>");
  });

  test("preserves UTC, EXDATE, RDATE, and bounded occurrence anchors", async () => {
    const source = await Bun.file(fixturePath).text();
    const result = await runRecordAdapter(icalAdapter, input(source));
    const recurring = result.records.find((record) =>
      record.stableId.includes("event-2")
    );

    expect(recurring?.metadata?.dateFields?.start).toBe("2026-07-22T10:00:00Z");
    expect(recurring?.anchors?.map((anchor) => anchor.value)).toEqual([
      "event-2@example.test",
      "20260722T100000Z",
      "20260724T100000Z",
      "20260730T100000Z",
    ]);
    expect(recurring?.markdown).toContain("FREQ=DAILY;COUNT=3");
  });

  test("uses UID plus RECURRENCE-ID as stable exception identity", async () => {
    const source = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:series\nRECURRENCE-ID;TZID=Europe/Zurich:20261025T090000\nDTSTART;TZID=Europe/Zurich:20261025T100000\nSUMMARY:Moved occurrence\nEND:VEVENT\nEND:VCALENDAR\n`;
    const first = await runRecordAdapter(icalAdapter, input(source, 1));
    const edited = await runRecordAdapter(
      icalAdapter,
      input(source.replace("Moved occurrence", "Edited occurrence"), 13)
    );

    expect(first.records[0]?.stableId).toContain(
      "series::recurrence:TZID=Europe/Zurich:20261025T090000"
    );
    expect(first.records[0]?.recordKey).toBe(edited.records[0]?.recordKey);
    expect(first.records[0]?.sourceHash).not.toBe(
      edited.records[0]?.sourceHash
    );
  });

  test("isolates malformed siblings and prevents authoritative deletion", async () => {
    const source = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:good\nDTSTART:20260722T100000Z\nSUMMARY:Good\nEND:VEVENT\nBEGIN:VEVENT\nUID:bad\nDTSTART:20260722T100000+0200\nSUMMARY:Invalid offset\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20260723T100000Z\nSUMMARY:Missing UID\nEND:VEVENT\nEND:VCALENDAR\n`;
    const result = await runRecordAdapter(icalAdapter, input(source));

    expect(result.records.map((record) => record.stableId)).toEqual([
      "ical:good",
    ]);
    expect(result.failures).toHaveLength(2);
    expect(result.authoritative).toBe(false);
  });

  test("marks truncated exports and invalid UTF-8 as partial", async () => {
    const truncated = await runRecordAdapter(
      icalAdapter,
      input("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:one\nSUMMARY:Open")
    );
    const invalidUtf8 = await runRecordAdapter(icalAdapter, {
      ...input(""),
      open: async function* () {
        yield Uint8Array.from([0xff, 0xfe]);
      },
    });

    expect(truncated.authoritative).toBe(false);
    expect(invalidUtf8.authoritative).toBe(false);
    expect(invalidUtf8.failures.some((failure) => failure.retryable)).toBe(
      true
    );
  });

  test("bounds supported recurrence expansion and flags unsupported rules", () => {
    const bounded = summarizeRecurrence(
      [{ name: "RRULE", value: "FREQ=DAILY;COUNT=1000" }],
      "20260722T100000Z",
      MAX_RECURRENCE_ANCHORS
    );
    const unsupported = summarizeRecurrence(
      [{ name: "RRULE", value: "FREQ=MONTHLY;COUNT=4" }],
      "20260722T100000Z"
    );

    expect(bounded.occurrenceAnchors).toHaveLength(MAX_RECURRENCE_ANCHORS);
    expect(bounded.truncated).toBe(true);
    expect(unsupported.occurrenceAnchors).toEqual([]);
    expect(unsupported.truncated).toBe(true);
  });

  test("matches only explicit iCalendar MIME or extension", () => {
    expect(icalAdapter.canHandle("text/calendar", ".bin")).toBe(true);
    expect(icalAdapter.canHandle("application/octet-stream", ".ics")).toBe(
      true
    );
    expect(icalAdapter.canHandle("text/plain", ".txt")).toBe(false);
  });
});
