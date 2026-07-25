import { beforeAll, describe, expect, test } from "bun:test";

import { assertInvalid, assertValid, loadSchema } from "./validator";

describe("record-import schema", () => {
  let schema: object;

  beforeAll(async () => {
    schema = await loadSchema("record-import");
  });

  const receipt = {
    adapterId: "adapter/test",
    adapterVersion: "1.0.0",
    adapterFingerprint: "a".repeat(64),
    snapshotState: "partial",
    authoritative: false,
    stoppedByCap: false,
    sourceBytesRead: 42,
    records: {
      accepted: 1,
      added: 0,
      updated: 0,
      reactivated: 0,
      unchanged: 1,
      deactivated: 0,
      preserved: 1,
      failed: 0,
    },
    items: [
      {
        outcome: "unchanged",
        recordKey: "b".repeat(64),
        sourceLocator: "line:1",
        sourceHash: "c".repeat(64),
        mirrorHash: "d".repeat(64),
        adapterFingerprint: "a".repeat(64),
        attachments: [
          {
            name: "agenda.pdf",
            mime: "application/pdf",
            bytes: 42,
            disposition: "attachment",
            sha256: "e".repeat(64),
          },
        ],
      },
    ],
    itemsTruncated: 0,
    warnings: [
      {
        code: "PARTIAL_SNAPSHOT",
        message:
          "Adapter reported a partial snapshot; unseen records were preserved.",
        retryable: true,
      },
    ],
    failures: [],
  };

  test("accepts a closed bounded receipt", () => {
    expect(assertValid(receipt, schema)).toBe(true);
  });

  test("rejects unbounded or unknown receipt fields", () => {
    expect(
      assertInvalid(
        {
          ...receipt,
          items: [
            {
              ...receipt.items[0],
              sourceLocator: "x".repeat(513),
            },
          ],
        },
        schema
      )
    ).toBe(true);
    expect(assertInvalid({ ...receipt, rawRecord: "private" }, schema)).toBe(
      true
    );
    expect(
      assertInvalid(
        {
          ...receipt,
          items: [
            {
              ...receipt.items[0],
              attachments: [{ name: "agenda.pdf", sha256: "invalid" }],
            },
          ],
        },
        schema
      )
    ).toBe(true);
  });
});
