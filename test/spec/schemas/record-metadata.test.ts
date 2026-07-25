import { describe, expect, test } from "bun:test";

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

const fullRecord = {
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
  threadId: "thread-1",
  eventId: "event-1",
  sessionId: "session-1",
  attachments: [
    {
      name: "agenda.txt",
      mime: "text/plain",
      bytes: 42,
      disposition: "attachment",
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
    });
  }
});
