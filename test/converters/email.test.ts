import { describe, expect, test } from "bun:test";

import type { RecordAdapterInput } from "../../src/converters/types";

import { emailRecordAdapter } from "../../src/converters/adapters/email/adapter";
import { runRecordAdapter } from "../../src/ingestion/record-adapter";

const fixturePath = (name: string): string =>
  new URL(`../fixtures/exports/mail/${name}`, import.meta.url).pathname;

const bytesInput = (
  bytes: Uint8Array,
  ext: ".eml" | ".mbox",
  overrides: Partial<RecordAdapterInput["limits"]> = {},
  chunkSize = 11
): RecordAdapterInput => ({
  sourcePath: `/private/mail/export${ext}`,
  relativePath: `export${ext}`,
  collection: "mail",
  mime: ext === ".mbox" ? "application/mbox" : "message/rfc822",
  ext,
  open: async function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    }
  },
  limits: {
    maxSourceBytes: 100_000,
    maxRecordChars: 10_000,
    maxMetadataChars: 10_000,
    maxTotalChars: 100_000,
    maxRecords: 100,
    maxFailures: 20,
    ...overrides,
  },
});

const fixtureInput = async (
  name: string,
  ext: ".eml" | ".mbox",
  chunkSize = 11
): Promise<RecordAdapterInput> => {
  const bytes = new Uint8Array(await Bun.file(fixturePath(name)).arrayBuffer());
  return bytesInput(bytes, ext, {}, chunkSize);
};

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("email export adapter", () => {
  test("recognizes only explicit EML and MBOX sources", () => {
    expect(emailRecordAdapter.canHandle("message/rfc822", ".bin")).toBe(true);
    expect(emailRecordAdapter.canHandle("application/mbox", ".bin")).toBe(true);
    expect(
      emailRecordAdapter.canHandle("application/octet-stream", ".EML")
    ).toBe(true);
    expect(
      emailRecordAdapter.canHandle("application/octet-stream", ".mbox")
    ).toBe(true);
    expect(emailRecordAdapter.canHandle("text/plain", ".txt")).toBe(false);
  });

  test("preserves folded identity, thread, dates, safe body, and attachment inventory", async () => {
    const result = await runRecordAdapter(
      emailRecordAdapter,
      await fixtureInput("nested.eml", ".eml", 7)
    );

    expect(result.authoritative).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.records).toHaveLength(1);
    const message = result.records[0];
    expect(message?.title).toBe("Quarterly Überblick");
    expect(message?.sourceLocator).toBe("message:1");
    expect(message?.metadata?.author).toContain("alice@example.com");
    expect(message?.metadata?.participants).toEqual([
      '"Alice Example" <alice@example.com>',
      "Bob Example <bob@example.com>",
      "team@example.com",
    ]);
    expect(message?.metadata?.dateFields?.sentAt).toBe(
      "2026-07-21T12:30:00.000Z"
    );
    expect(message?.metadata?.threadId).toBe("root@example.com");
    expect(message?.metadata?.attachments).toEqual([
      {
        name: "invoice.pdf",
        mime: "application/pdf",
        bytes: 17,
        disposition: "attachment",
      },
    ]);
    expect(message?.markdown).toContain("Der Gründungsbericht ist fertig.");
    expect(message?.markdown).toContain("sha256:");
    expect(message?.markdown).not.toContain("secret attachment");
    expect(message?.markdown).not.toContain("evil.example");
  });

  test("reduces HTML-only messages to text without retaining executable or remote attributes", async () => {
    const result = await runRecordAdapter(
      emailRecordAdapter,
      await fixtureInput("html-only.eml", ".eml")
    );
    const markdown = result.records[0]?.markdown ?? "";

    expect(result.authoritative).toBe(true);
    expect(markdown).toContain("Visible link.");
    for (const unsafe of [
      "javascript:",
      "fetch(",
      "file://",
      "tracker.example",
      "<iframe",
      "<img",
      "display: none",
    ]) {
      expect(markdown).not.toContain(unsafe);
    }
  });

  test("renders plain-text markup as inert evidence rather than active HTML, links, or images", async () => {
    const eml = [
      "From: Sender <sender@example.com>",
      "Message-ID: <plain-markup@example.com>",
      "Subject: Plain markup",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "<script>alert(1)</script>",
      "[open](javascript:alert(2))",
      "![track](https://tracker.example/pixel)",
    ].join("\r\n");
    const result = await runRecordAdapter(
      emailRecordAdapter,
      bytesInput(encode(eml), ".eml")
    );
    const markdown = result.records[0]?.markdown ?? "";

    expect(result.authoritative).toBe(true);
    expect(markdown).toContain("\\<script\\>");
    expect(markdown).toContain("\\[open\\](javascript:alert(2))");
    expect(markdown).toContain("!\\[track\\](https://tracker.example/pixel)");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("[open](javascript:");
    expect(markdown).not.toContain("![track](");
  });

  test("streams MBOX siblings while disclosing duplicate and missing identities", async () => {
    const input = await fixtureInput("mixed.mbox", ".mbox", 5);
    const first = await runRecordAdapter(emailRecordAdapter, input);
    const second = await runRecordAdapter(
      emailRecordAdapter,
      await fixtureInput("mixed.mbox", ".mbox", 17)
    );

    expect(first.authoritative).toBe(false);
    expect(first.snapshotState).toBe("partial");
    expect(first.records).toHaveLength(3);
    expect(first.records.map((record) => record.sourceLocator)).toEqual([
      "message:2",
      "message:1",
      "message:3",
    ]);
    expect(new Set(first.records.map((record) => record.recordKey)).size).toBe(
      3
    );
    expect(
      first.failures.some((failure) => failure.code === "DUPLICATE_ID")
    ).toBe(false);
    expect(
      first.failures.some((failure) => failure.code === "MALFORMED_RECORD")
    ).toBe(true);
    expect(
      first.records.some((record) => record.markdown.includes("Occurrence: 2"))
    ).toBe(true);
    expect(
      first.records.some((record) =>
        record.markdown.includes("content-derived identity")
      )
    ).toBe(true);
    expect(
      first.records.some((record) =>
        record.markdown.includes("Grüße aus Basel")
      )
    ).toBe(true);
    expect(second.records).toEqual(first.records);
    expect(second.failures).toEqual(first.failures);
  });

  test("isolates an oversized MBOX message and continues with the next sibling", async () => {
    const mailbox = [
      "From huge@example.com Tue Jul 21 14:30:00 2026",
      "From: Huge <huge@example.com>",
      "Message-ID: <huge@example.com>",
      "Subject: Huge",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "x".repeat(5_000),
      "From safe@example.com Tue Jul 21 14:31:00 2026",
      "From: Safe <safe@example.com>",
      "Message-ID: <safe@example.com>",
      "Subject: Safe",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "bounded sibling",
    ].join("\n");
    const result = await runRecordAdapter(
      emailRecordAdapter,
      bytesInput(
        encode(mailbox),
        ".mbox",
        {
          maxSourceBytes: 20_000,
          maxRecordChars: 512,
          maxMetadataChars: 1_000,
        },
        37
      )
    );

    expect(result.authoritative).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.markdown).toContain("bounded sibling");
    expect(
      result.failures.some((failure) => failure.code === "RECORD_TOO_LARGE")
    ).toBe(true);
  });

  test("rejects oversized attachment expansion without indexing attachment bytes", async () => {
    const encodedAttachment = Uint8Array.from(
      { length: 2_048 },
      () => 65
    ).toBase64();
    const eml = [
      "From: Sender <sender@example.com>",
      "Message-ID: <oversized-attachment@example.com>",
      "Subject: Attachment",
      'Content-Type: application/octet-stream; name="payload.bin"',
      'Content-Disposition: attachment; filename="payload.bin"',
      "Content-Transfer-Encoding: base64",
      "",
      encodedAttachment,
    ].join("\r\n");
    const result = await runRecordAdapter(
      emailRecordAdapter,
      bytesInput(encode(eml), ".eml", {
        maxRecordChars: 512,
        maxMetadataChars: 1_000,
      })
    );

    expect(result.records).toEqual([]);
    expect(result.authoritative).toBe(false);
    expect(
      result.failures.some((failure) => failure.code === "MALFORMED_RECORD")
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("AAAA");
  });

  test("treats empty mail as an isolated malformed record", async () => {
    const result = await runRecordAdapter(
      emailRecordAdapter,
      bytesInput(new Uint8Array(), ".eml")
    );

    expect(result.records).toEqual([]);
    expect(result.authoritative).toBe(false);
    expect(result.failures[0]?.code).toBe("MALFORMED_RECORD");
  });
});
