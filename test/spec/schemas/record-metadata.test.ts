import { describe, expect, test } from "bun:test";

import {
  projectRecordEvidenceMetadata,
  type RecordEvidenceMetadata,
} from "../../../src/core/record-metadata";
import { assertInvalid, assertValid, loadSchema } from "./validator";

type JsonObject = Record<string, unknown>;

const objectAt = (value: unknown, keys: string[]): JsonObject => {
  let current = value;
  for (const key of keys) {
    if (!(current && typeof current === "object" && key in current)) {
      throw new Error(`Missing schema path: ${keys.join(".")}`);
    }
    current = (current as JsonObject)[key];
  }
  if (!(current && typeof current === "object")) {
    throw new Error(`Schema path is not an object: ${keys.join(".")}`);
  }
  return current as JsonObject;
};

const recordSchemaPaths = {
  ask: ["$defs", "searchResult", "properties", "record"],
  "context-capsule-v1": ["definitions", "recordEvidenceMetadata"],
  get: ["properties", "record"],
  "multi-get": ["properties", "documents", "items", "properties", "record"],
  "search-result": ["properties", "record"],
  "search-results": ["$defs", "searchResult", "properties", "record"],
} as const;

const fullRecord: RecordEvidenceMetadata = {
  recordKey: "a".repeat(64),
  sourceLocator: "message:abc@example.test",
  anchors: [
    {
      kind: "timestamp",
      value: "00:01:02.000",
      endValue: "00:01:05.000",
    },
  ],
  adapter: {
    id: "adapter/transcript",
    version: "1.0.0",
    fingerprint: "b".repeat(64),
  },
  author: "Ada",
  participants: ["Ada", "Grace"],
  categories: ["decision"],
  dateFields: { created: "2026-07-22T12:00:00.000Z" },
  messageId: "message@example.test",
  inReplyTo: "parent@example.test",
  references: ["root@example.test", "parent@example.test"],
  threadId: "thread-1",
  eventId: "event-1",
  sessionId: "session-1",
  attachments: [
    {
      name: "agenda.txt",
      mime: "text/plain",
      bytes: 42,
      disposition: "attachment",
      sha256: "c".repeat(64),
    },
  ],
};

describe("logical record metadata schema parity", () => {
  for (const [schemaName, path] of Object.entries(recordSchemaPaths)) {
    test(`${schemaName} accepts the complete closed bounded projection`, async () => {
      const rootSchema = await loadSchema(schemaName);
      const recordSchema = objectAt(rootSchema, [...path]);
      const schema =
        schemaName === "context-capsule-v1"
          ? {
              ...recordSchema,
              definitions: objectAt(rootSchema, ["definitions"]),
            }
          : recordSchema;
      expect(assertValid(fullRecord, schema)).toBe(true);
      expect(
        assertInvalid({ ...fullRecord, absolutePath: "/private" }, schema)
      ).toBe(true);
      expect(
        assertInvalid(
          { ...fullRecord, participants: ["x".repeat(2049)] },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            anchors: [{ kind: "timestamp", value: "x".repeat(513) }],
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            adapter: { ...fullRecord.adapter, id: "x".repeat(129) },
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            adapter: { ...fullRecord.adapter, version: "x".repeat(65) },
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            anchors: [{ kind: "offset", value: "1" }],
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            attachments: [
              {
                name: "agenda.txt",
                disposition: "download",
              },
            ],
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            attachments: [
              {
                name: "agenda.txt",
                bytes: Number.MAX_SAFE_INTEGER + 1,
              },
            ],
          },
          schema
        )
      ).toBe(true);
      expect(
        assertInvalid({ ...fullRecord, references: ["x".repeat(2049)] }, schema)
      ).toBe(true);
      expect(
        assertInvalid(
          {
            ...fullRecord,
            attachments: [{ name: "agenda.txt", sha256: "not-a-sha256" }],
          },
          schema
        )
      ).toBe(true);
    });
  }

  test("projection retains the structured mail chain and attachment digest", () => {
    const projected = projectRecordEvidenceMetadata({
      recordKey: fullRecord.recordKey,
      recordSourceLocator: fullRecord.sourceLocator,
      recordMetadata: {
        messageId: fullRecord.messageId,
        inReplyTo: fullRecord.inReplyTo,
        references: fullRecord.references,
        attachments: fullRecord.attachments,
      },
      recordAnchors: fullRecord.anchors,
      converterId: fullRecord.adapter.id,
      converterVersion: fullRecord.adapter.version,
      recordAdapterFingerprint: fullRecord.adapter.fingerprint,
    });

    expect(projected?.messageId).toBe(fullRecord.messageId);
    expect(projected?.inReplyTo).toBe(fullRecord.inReplyTo);
    expect(projected?.references).toEqual(fullRecord.references);
    expect(projected?.attachments?.[0]?.sha256).toBe(
      fullRecord.attachments?.[0]?.sha256
    );
  });
});
