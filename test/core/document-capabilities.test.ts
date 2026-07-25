import { describe, expect, test } from "bun:test";

import { getDocumentCapabilities } from "../../src/core/document-capabilities";

describe("document capabilities", () => {
  test("keeps ordinary text sources editable", () => {
    expect(
      getDocumentCapabilities({
        sourceExt: ".txt",
        sourceMime: "text/plain",
        contentAvailable: true,
      })
    ).toMatchObject({
      editable: true,
      mode: "editable",
    });
  });

  test("forces logical export records into the read-only lane", () => {
    expect(
      getDocumentCapabilities({
        sourceExt: ".vtt",
        sourceMime: "text/vtt",
        contentAvailable: true,
        recordKey: "a".repeat(64),
      })
    ).toEqual({
      editable: false,
      tagsEditable: true,
      tagsWriteback: false,
      canCreateEditableCopy: true,
      mode: "read_only",
      reason:
        "This document is a logical record derived from a file/export container and cannot be written back in place.",
    });
  });
});
